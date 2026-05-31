import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../../logger.js";
import {
  ChatTurnValidationError,
  compactChatSession,
  isSupportedProviderSlashCommand,
  prepareChatTurn,
  prepareProviderCommandTurn,
  runPreparedChatTurn,
  type PreparedChatTurn,
} from "../../chat-runner.js";
import {
  clearActiveRun,
  createActiveRun,
  getActiveRunController,
  hasActiveRun,
} from "../active-runs.js";
import {
  attachAgentStreamClient,
  createActiveAgentStream,
  emitAgentStream,
  finishAgentStream,
  hasActiveAgentStream,
  type AgentStreamEvent,
} from "../agent-stream.js";
import * as db from "../db.js";
import { getSessionWorkdir } from "../services/projects.js";
import {
  prepareWebChatInput,
  type ChatAttachment,
  type ChatFileReference,
  type ChatPromptProject,
  type ChatPromptSkill,
} from "../services/web-chat-input.js";

function cleanProviderCommand(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCompactCommand(value: string): boolean {
  return value.trim().toLowerCase() === "/compact";
}

function getAutomaticProviderCommand(
  session: db.ChatSessionMetadata,
  userText: string,
  attachmentCount: number,
  skillCount: number,
  projectCount: number,
): string {
  const commandText = userText.trim();
  if (!commandText || !commandText.startsWith("/")) return "";
  if (isCompactCommand(commandText)) return "";
  if (attachmentCount > 0 || skillCount > 0 || projectCount > 0) return "";
  return isSupportedProviderSlashCommand(session, commandText) ? commandText : "";
}

type WebMessageRequestBody = {
  content?: string;
  attachments?: ChatAttachment[];
  fileReferences?: ChatFileReference[];
  skills?: ChatPromptSkill[];
  projects?: ChatPromptProject[];
  modelId?: string;
  providerCommand?: string;
};

type PreparedWebMessageRequest = {
  input: ReturnType<typeof prepareWebChatInput>;
  modelId?: string;
  providerCommandText: string;
};

type WebMessageRequestError = {
  statusCode: number;
  error: string;
};

function prepareWebMessageRequest(
  body: WebMessageRequestBody,
  session: db.ChatSessionMetadata,
  workdir: string,
): PreparedWebMessageRequest | WebMessageRequestError {
  const { content, attachments, fileReferences, skills, projects, modelId, providerCommand } = body;
  const explicitProviderCommand = cleanProviderCommand(providerCommand);
  const requestAttachments = Array.isArray(attachments) ? attachments : [];
  const requestFileReferences = Array.isArray(fileReferences) ? fileReferences : [];
  const requestSkills = Array.isArray(skills) ? skills : [];
  const requestProjects = Array.isArray(projects) ? projects : [];
  const input = prepareWebChatInput(content, requestAttachments, requestSkills, requestProjects, requestFileReferences, {
    sessionProjectId: session.projectId,
    workdir,
  });
  if (!input.userText && requestAttachments.length === 0 && input.fileReferenceCount === 0 && !explicitProviderCommand) {
    return { statusCode: 400, error: "消息不能为空" };
  }

  const providerCommandText = explicitProviderCommand || getAutomaticProviderCommand(
    session,
    input.userText,
    requestAttachments.length,
    requestSkills.length,
    requestProjects.length + input.fileReferenceCount,
  );
  if (providerCommandText && isCompactCommand(providerCommandText)) {
    return { statusCode: 400, error: "请使用压缩上下文入口" };
  }
  if (
    explicitProviderCommand &&
    (requestAttachments.length > 0 || requestFileReferences.length > 0 || requestSkills.length > 0 || requestProjects.length > 0)
  ) {
    return { statusCode: 400, error: "执行命令时不能同时附加文件、技能或项目" };
  }

  return { input, modelId, providerCommandText };
}

function isWebMessageRequestError(
  request: PreparedWebMessageRequest | WebMessageRequestError,
): request is WebMessageRequestError {
  return "statusCode" in request;
}

export function createMessagesRouter(): Router {
  const router = Router();

  router.get("/sessions/:id/messages/stream", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (!attachAgentStreamClient(id, res)) {
      res.status(404).json({ error: "当前会话没有正在进行的流式响应" });
      return;
    }
  });

  router.post("/sessions/:id/messages/cancel", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    const controller = getActiveRunController(id);
    if (!controller) {
      res.status(409).json({ error: "当前会话没有正在处理的 Claude/Codex 请求" });
      return;
    }

    controller.abort();
    logger.info("web.chat.cancel.requested", { sessionId: id, provider: session.provider });
    res.json({ ok: true });
  });

  router.post("/sessions/:id/compact", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (hasActiveAgentStream(id) || hasActiveRun(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再压缩上下文" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    const { modelId } = req.body as { modelId?: string };
    const activeRun = createActiveRun(id, "compact");

    try {
      const result = await compactChatSession({
        session,
        modelId,
        workdir: sessionWorkdir,
        signal: activeRun.controller.signal,
        logPrefix: "web.chat.compact",
      });

      res.json({
        role: "assistant",
        content: result.content,
        title: result.title,
        messageId: result.messageId,
        createdAt: result.createdAt,
        provider: result.provider,
        contextUsage: result.contextUsage,
      });
    } catch (error) {
      if (error instanceof ChatTurnValidationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      if (activeRun.controller.signal.aborted) {
        res.status(499).json({ error: "压缩已停止", canceled: true });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "压缩上下文失败，请稍后再试。";
      res.status(500).json({ error: errorMessage });
    } finally {
      clearActiveRun(id, activeRun.controller);
    }
  });

  router.post("/sessions/:id/messages/stream", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (hasActiveAgentStream(id) || hasActiveRun(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再发送新消息" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    const request = prepareWebMessageRequest(req.body as WebMessageRequestBody, session, sessionWorkdir);
    if (isWebMessageRequestError(request)) {
      res.status(request.statusCode).json({ error: request.error });
      return;
    }
    const { input, modelId, providerCommandText } = request;

    let prepared: PreparedChatTurn;
    try {
      prepared = providerCommandText
        ? prepareProviderCommandTurn({
            session,
            commandText: providerCommandText,
            modelId,
            workdir: sessionWorkdir,
          })
        : prepareChatTurn({
            session,
            userText: input.userText,
            storedUserContent: input.storedUserContent,
            titleText: input.titleText,
            userMetadata: input.userMetadata,
            imagePaths: input.imagePaths,
            modelId,
            workdir: sessionWorkdir,
            includeWorkspaceMemory: !session.projectId,
            requireStreaming: true,
          });
    } catch (error) {
      if (error instanceof ChatTurnValidationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "模型不可用" });
      return;
    }

    const activeRun = createActiveRun(id, "message");
    const active = createActiveAgentStream(id);
    attachAgentStreamClient(id, res);

    let streamReleased = false;
    const releaseStream = () => {
      if (streamReleased) return;
      streamReleased = true;
      clearActiveRun(id, activeRun.controller);
      finishAgentStream(id, active);
    };
    const emit = (event: AgentStreamEvent) => {
      emitAgentStream(active, event);
      if (event.type === "codex_answer_done") {
        releaseStream();
      }
    };

    void (async () => {
      try {
        await runPreparedChatTurn(prepared, {
          signal: activeRun.controller.signal,
          stream: { emit },
          logPrefix: "web.chat.stream",
          logFields: { fileCount: input.fileCount, fileReferenceCount: input.fileReferenceCount, skillCount: input.skillCount, projectCount: input.projectCount },
        });
      } catch {
        // runPreparedChatTurn 已记录日志并推送 error 事件，这里只负责收尾。
      } finally {
        releaseStream();
      }
    })();
  });

  router.post("/sessions/:id/messages", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (hasActiveAgentStream(id) || hasActiveRun(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再发送新消息" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    const request = prepareWebMessageRequest(req.body as WebMessageRequestBody, session, sessionWorkdir);
    if (isWebMessageRequestError(request)) {
      res.status(request.statusCode).json({ error: request.error });
      return;
    }
    const { input, modelId, providerCommandText } = request;

    try {
      const prepared = providerCommandText
        ? prepareProviderCommandTurn({
            session,
            commandText: providerCommandText,
            modelId,
            workdir: sessionWorkdir,
          })
        : prepareChatTurn({
            session,
            userText: input.userText,
            storedUserContent: input.storedUserContent,
            titleText: input.titleText,
            userMetadata: input.userMetadata,
            imagePaths: input.imagePaths,
            modelId,
            workdir: sessionWorkdir,
            includeWorkspaceMemory: !session.projectId,
          });
      const result = await runPreparedChatTurn(prepared, {
        logPrefix: providerCommandText ? "web.chat.provider_command" : "web.chat",
        logFields: { fileCount: input.fileCount, fileReferenceCount: input.fileReferenceCount, skillCount: input.skillCount, projectCount: input.projectCount },
      });

      res.json({
        role: "assistant",
        content: result.content,
        title: result.title,
        provider: result.provider,
        changeReview: result.changeReview,
        contextUsage: result.contextUsage,
      });
    } catch (error) {
      if (error instanceof ChatTurnValidationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "处理消息时出错了，请稍后再试。";
      res.status(500).json({ error: errorMessage });
    }
  });

  return router;
}
