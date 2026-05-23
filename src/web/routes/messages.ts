import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../../logger.js";
import {
  ChatTurnValidationError,
  prepareChatTurn,
  runChatTurn,
  runPreparedChatTurn,
  type PreparedChatTurn,
} from "../../chat-runner.js";
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
  type ChatPromptProject,
  type ChatPromptSkill,
} from "../services/web-chat-input.js";

const activeRunControllers = new Map<string, AbortController>();

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

    const controller = activeRunControllers.get(id);
    if (!controller) {
      res.status(409).json({ error: "当前会话没有正在处理的 Claude/Codex 请求" });
      return;
    }

    controller.abort();
    logger.info("web.chat.cancel.requested", { sessionId: id, provider: session.provider });
    res.json({ ok: true });
  });

  router.post("/sessions/:id/messages/stream", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (hasActiveAgentStream(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再发送新消息" });
      return;
    }

    const { content, attachments, skills, projects, modelId } = req.body as {
      content?: string;
      attachments?: ChatAttachment[];
      skills?: ChatPromptSkill[];
      projects?: ChatPromptProject[];
      modelId?: string;
    };
    const requestAttachments = Array.isArray(attachments) ? attachments : [];
    const requestSkills = Array.isArray(skills) ? skills : [];
    const requestProjects = Array.isArray(projects) ? projects : [];
    const input = prepareWebChatInput(content, requestAttachments, requestSkills, requestProjects, {
      sessionProjectId: session.projectId,
    });
    if (!input.userText && requestAttachments.length === 0) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    let prepared: PreparedChatTurn;
    try {
      prepared = prepareChatTurn({
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

    const runAbortController = new AbortController();
    activeRunControllers.set(id, runAbortController);
    const active = createActiveAgentStream(id);
    attachAgentStreamClient(id, res);

    const emit = (event: AgentStreamEvent) => emitAgentStream(active, event);

    void (async () => {
      try {
        await runPreparedChatTurn(prepared, {
          signal: runAbortController.signal,
          stream: { emit },
          logPrefix: "web.chat.stream",
          logFields: { fileCount: input.fileCount, skillCount: input.skillCount, projectCount: input.projectCount },
        });
      } catch {
        // runPreparedChatTurn 已记录日志并推送 error 事件，这里只负责收尾。
      } finally {
        activeRunControllers.delete(id);
        finishAgentStream(id, active);
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

    if (hasActiveAgentStream(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再发送新消息" });
      return;
    }

    const { content, attachments, skills, projects, modelId } = req.body as {
      content?: string;
      attachments?: ChatAttachment[];
      skills?: ChatPromptSkill[];
      projects?: ChatPromptProject[];
      modelId?: string;
    };
    const requestAttachments = Array.isArray(attachments) ? attachments : [];
    const requestSkills = Array.isArray(skills) ? skills : [];
    const requestProjects = Array.isArray(projects) ? projects : [];
    const input = prepareWebChatInput(content, requestAttachments, requestSkills, requestProjects, {
      sessionProjectId: session.projectId,
    });
    if (!input.userText && requestAttachments.length === 0) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    try {
      const result = await runChatTurn({
        session,
        userText: input.userText,
        storedUserContent: input.storedUserContent,
        titleText: input.titleText,
        userMetadata: input.userMetadata,
        imagePaths: input.imagePaths,
        modelId,
        workdir: sessionWorkdir,
        includeWorkspaceMemory: !session.projectId,
        logPrefix: "web.chat",
        logFields: { fileCount: input.fileCount, skillCount: input.skillCount, projectCount: input.projectCount },
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
