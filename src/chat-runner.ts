import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  createProvider,
  getProvider,
  getRegisteredProviderTypes,
} from "./providers/index.js";
import type { IProvider, RunResult } from "./providers/index.js";
import type { ClaudeAgentStreamEvent } from "./providers/claude-code-agent-events.js";
import { ProviderCancelledError } from "./providers/types.js";
import {
  includeContentInLogs,
  includePromptInLogs,
  logger,
  rawLogString,
} from "./logger.js";
import {
  buildFirstTurnPrompt,
  buildResumePrompt,
  generateId,
  generateTitle,
  getSandbox,
  getWorkdir,
} from "./shared.js";
import { getModelForProvider } from "./web/model-config.js";
import * as db from "./web/db.js";
import { buildAssistantMetadata, type AgentStreamEvent } from "./web/agent-stream.js";
import {
  collectChangeReview,
  createChangeSnapshot,
  type PublicChangeReview,
} from "./web/change-review.js";
import { emitSessionsChanged } from "./web/events.js";

export type ChatSessionRecord = db.ChatSessionMetadata & {
  messages?: db.ChatMessage[];
};

export class ChatTurnValidationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ChatTurnValidationError";
  }
}

export type PreparedChatTurn = {
  session: ChatSessionRecord;
  provider: IProvider;
  model: string;
  workdir: string;
  sandbox: ReturnType<typeof getSandbox>;
  source: string;
  prompt: string;
  userText: string;
  storedUserContent: string;
  titleText: string;
  userMetadata: string | null;
  imagePaths: string[];
  providerSessionId: string | null;
  rawProviderCommand?: boolean;
};

export type PrepareChatTurnOptions = {
  session: ChatSessionRecord;
  userText: string;
  storedUserContent?: string;
  titleText?: string;
  userMetadata?: string | null;
  imagePaths?: string[];
  modelId?: string;
  workdir?: string;
  includeWorkspaceMemory?: boolean;
  requireStreaming?: boolean;
};

export type PrepareProviderCommandTurnOptions = {
  session: ChatSessionRecord;
  commandText: string;
  modelId?: string;
  workdir?: string;
};

export type RunPreparedChatTurnOptions = {
  signal?: AbortSignal;
  stream?: {
    emit: (event: AgentStreamEvent) => void | Promise<void>;
  };
  logPrefix: string;
  logFields?: Record<string, unknown>;
};

export type ChatTurnResult = {
  status: "success" | "cancelled";
  content: string;
  title: string;
  sessionId: string | null;
  provider: string;
  changeReview: PublicChangeReview | null;
  contextUsage?: RunResult["contextUsage"];
};

export type CompactChatSessionResult = {
  content: string;
  title: string;
  messageId: number;
  createdAt: number;
  sessionId: string | null;
  provider: string;
  contextUsage?: RunResult["contextUsage"];
};

function isRegisteredProviderType(providerType: string): boolean {
  return getRegisteredProviderTypes().includes(providerType);
}

function bindSessionProvider(session: Pick<db.ChatSession, "id" | "provider">): string {
  if (!session.provider || !isRegisteredProviderType(session.provider)) {
    const fallbackProvider = getProvider().type;
    if (session.provider) {
      logger.warn("chat.session_provider_unsupported", {
        sessionId: session.id,
        provider: session.provider,
        fallback: fallbackProvider,
      });
    }
    session.provider = fallbackProvider;
  }
  return session.provider;
}

function getSessionProvider(session: Pick<db.ChatSession, "id" | "provider">): IProvider {
  const currentProvider = getProvider();
  const providerType = bindSessionProvider(session);
  return providerType === currentProvider.type ? currentProvider : createProvider(providerType);
}

function isStreamingProvider(
  provider: IProvider,
): provider is IProvider & Required<Pick<IProvider, "runWithEvents">> {
  return typeof provider.runWithEvents === "function";
}

function resolveRunModel(provider: IProvider, requestedModelId?: string): string {
  const fallback = getModelForProvider(provider.type);
  const modelId = requestedModelId?.trim();
  if (!modelId) return fallback;

  const valid = provider.listModels().some((model) => model.id === modelId);
  if (!valid) {
    throw new ChatTurnValidationError(`不支持的模型: ${modelId}`);
  }
  return modelId;
}

function normalizeProviderCommandText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function getProviderSlashCommand(
  provider: IProvider,
  commandText: string,
): ReturnType<Required<IProvider>["listSlashCommands"]>[number] | null {
  const normalized = normalizeProviderCommandText(commandText).toLowerCase();
  if (!normalized) return null;
  const commands = provider.listSlashCommands?.() || [];
  return commands.find((item) => {
    const command = normalizeProviderCommandText(item.command || item.id).toLowerCase();
    const id = normalizeProviderCommandText(item.id).toLowerCase();
    return command === normalized || id === normalized;
  }) || null;
}

export function isSupportedProviderSlashCommand(
  session: Pick<db.ChatSession, "id" | "provider">,
  commandText: string,
): boolean {
  return Boolean(getProviderSlashCommand(getSessionProvider(session), commandText));
}

function getProviderSlashCommandPrompt(
  command: ReturnType<Required<IProvider>["listSlashCommands"]>[number],
): string {
  return normalizeProviderCommandText(command.command || command.id);
}

async function safeCreateChangeSnapshotForWorkdir(
  workdir: string,
): Promise<Awaited<ReturnType<typeof createChangeSnapshot>>> {
  try {
    return await createChangeSnapshot(workdir);
  } catch (error) {
    logger.warn("change_review.snapshot_failed", { error });
    return null;
  }
}

async function safeCollectChangeReview(
  snapshot: Awaited<ReturnType<typeof createChangeSnapshot>>,
): Promise<PublicChangeReview | null> {
  try {
    return await collectChangeReview(snapshot);
  } catch (error) {
    logger.warn("change_review.collect_failed", { error });
    return null;
  }
}

function shouldPersistAgentEvent(event: AgentStreamEvent): event is ClaudeAgentStreamEvent {
  return (
    event.type !== "result" &&
    event.type !== "error" &&
    event.type !== "cancelled" &&
    event.type !== "done"
  );
}

function buildLogFields(prepared: PreparedChatTurn, opts: RunPreparedChatTurnOptions) {
  return {
    sessionId: prepared.session.id,
    providerSessionId: prepared.providerSessionId,
    source: prepared.source,
    provider: prepared.provider.type,
    model: prepared.model,
    workdir: prepared.workdir,
    userTextChars: prepared.userText.length,
    imageCount: prepared.imagePaths.length,
    promptChars: prepared.prompt.length,
    ...(opts.logFields || {}),
    ...(includeContentInLogs() ? { userText: rawLogString(prepared.userText) } : {}),
    ...(includePromptInLogs() ? { prompt: rawLogString(prepared.prompt) } : {}),
  };
}

export function createChannelSession(
  source: string,
  chatId: string,
  projectId: string | null = null,
): db.ChatSession {
  const now = Date.now();
  const session: db.ChatSession = {
    id: generateId(),
    title: "新对话",
    sessionId: null,
    provider: getProvider().type,
    source,
    chatId,
    projectId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  db.createSession(session);
  emitSessionsChanged(session.id, "session_created");
  return session;
}

export function getOrCreateChannelSession(source: string, chatId: string): ChatSessionRecord {
  const existing = db.findSessionMetadataBySourceChat(source, chatId);
  if (existing) return existing;
  return createChannelSession(source, chatId);
}

export function resetChannelSession(chatId: string, source?: string): void {
  logger.info("chat.session.reset", {
    chatId,
    source: source || "unknown",
  });
  if (source) {
    db.detachChatId(source, chatId);
  }
}

export function getSessionWorkdir(session: Pick<db.ChatSession, "projectId">): string {
  if (!session.projectId) return getWorkdir();
  const project = db.getProject(session.projectId);
  if (!project) {
    throw new Error("项目不存在");
  }
  const resolved = fs.realpathSync(path.resolve(project.path));
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error("项目路径必须是文件夹");
  }
  return resolved;
}

export function prepareChatTurn(opts: PrepareChatTurnOptions): PreparedChatTurn {
  const provider = getSessionProvider(opts.session);
  if (opts.requireStreaming && !isStreamingProvider(provider)) {
    throw new ChatTurnValidationError("当前会话或 Provider 不支持 Agent 流式展示", 409);
  }

  const model = resolveRunModel(provider, opts.modelId);
  const workdir = opts.workdir || getWorkdir();
  const sandbox = getSandbox();
  const source = opts.session.source || "web";
  const userText = opts.userText.trim();
  const providerSessionId = opts.session.sessionId || null;
  const prompt = providerSessionId
    ? buildResumePrompt(userText, source)
    : buildFirstTurnPrompt(userText, source, {
        workdir,
        sandbox,
        includeWorkspaceMemory: opts.includeWorkspaceMemory,
      });

  return {
    session: opts.session,
    provider,
    model,
    workdir,
    sandbox,
    source,
    prompt,
    userText,
    storedUserContent: opts.storedUserContent ?? userText,
    titleText: opts.titleText ?? opts.storedUserContent ?? userText,
    userMetadata: opts.userMetadata ?? null,
    imagePaths: opts.imagePaths || [],
    providerSessionId,
  };
}

export function prepareProviderCommandTurn(
  opts: PrepareProviderCommandTurnOptions,
): PreparedChatTurn {
  const provider = getSessionProvider(opts.session);
  const command = getProviderSlashCommand(provider, opts.commandText);
  if (!command) {
    throw new ChatTurnValidationError("当前 Provider 不支持这个命令", 409);
  }

  const model = resolveRunModel(provider, opts.modelId);
  const workdir = opts.workdir || getWorkdir();
  const sandbox = getSandbox();
  const source = opts.session.source || "web";
  const prompt = getProviderSlashCommandPrompt(command);
  const providerSessionId = opts.session.sessionId || null;

  return {
    session: opts.session,
    provider,
    model,
    workdir,
    sandbox,
    source,
    prompt,
    userText: prompt,
    storedUserContent: prompt,
    titleText: command.name || prompt,
    userMetadata: null,
    imagePaths: [],
    providerSessionId,
    rawProviderCommand: true,
  };
}

export function canStreamPreparedChatTurn(prepared: PreparedChatTurn): boolean {
  return isStreamingProvider(prepared.provider);
}

export async function runPreparedChatTurn(
  prepared: PreparedChatTurn,
  opts: RunPreparedChatTurnOptions,
): Promise<ChatTurnResult> {
  const agentEvents: ClaudeAgentStreamEvent[] = [];
  const emitStream = async (event: AgentStreamEvent): Promise<void> => {
    if (shouldPersistAgentEvent(event)) {
      agentEvents.push(event);
    }
    await opts.stream?.emit(event);
  };

  db.addMessage(
    prepared.session.id,
    "user",
    prepared.storedUserContent,
    prepared.userMetadata,
  );

  if (db.countMessages(prepared.session.id) <= 1) {
    prepared.session.title = generateTitle(prepared.titleText);
  }
  db.updateSession({
    id: prepared.session.id,
    title: prepared.session.title,
    sessionId: prepared.session.sessionId,
    provider: prepared.session.provider,
    updatedAt: Date.now(),
  });
  emitSessionsChanged(prepared.session.id, "user_message_added");

  logger.info(`${opts.logPrefix}.start`, buildLogFields(prepared, opts));

  const changeSnapshot = await safeCreateChangeSnapshotForWorkdir(prepared.workdir);
  try {
    const runOptions = {
      workdir: prepared.workdir,
      sandbox: prepared.sandbox,
      model: prepared.model,
      prompt: prepared.prompt,
      imagePaths: prepared.imagePaths.length > 0 ? prepared.imagePaths : undefined,
      sessionId: prepared.providerSessionId || undefined,
      newSessionId: prepared.providerSessionId ? undefined : randomUUID(),
      rawProviderCommand: prepared.rawProviderCommand,
      signal: opts.signal,
    };
    const result = opts.stream && isStreamingProvider(prepared.provider)
      ? await prepared.provider.runWithEvents({
          ...runOptions,
          onEvent: (event) => emitStream(event),
        })
      : await prepared.provider.run(runOptions);

    const providerSessionId = result.sessionId || prepared.providerSessionId;
    const changeReview = await safeCollectChangeReview(changeSnapshot);
    if (result.contextUsage) {
      await emitStream({
        type: "context_usage",
        usage: result.contextUsage,
      });
    }

    db.addMessage(
      prepared.session.id,
      "assistant",
      result.text,
      buildAssistantMetadata({
        provider: prepared.provider.type,
        events: opts.stream ? agentEvents : undefined,
        changeReview,
      }),
    );
    db.updateSession({
      id: prepared.session.id,
      title: prepared.session.title,
      sessionId: providerSessionId,
      provider: prepared.session.provider,
      updatedAt: Date.now(),
    });
    prepared.session.sessionId = providerSessionId;
    emitSessionsChanged(prepared.session.id, "assistant_message_added");

    await emitStream({
      type: "result",
      content: result.text,
      title: prepared.session.title,
      sessionId: providerSessionId,
      provider: prepared.provider.type,
      changeReview,
      contextUsage: result.contextUsage,
    });

    logger.info(`${opts.logPrefix}.success`, {
      sessionId: prepared.session.id,
      providerSessionId,
      source: prepared.source,
      provider: prepared.provider.type,
      replyChars: result.text.length,
      streamedToWeb: !!opts.stream,
      ...(opts.logFields || {}),
      ...(includeContentInLogs() ? { replyText: rawLogString(result.text) } : {}),
    });

    return {
      status: "success",
      content: result.text,
      title: prepared.session.title,
      sessionId: providerSessionId,
      provider: prepared.provider.type,
      changeReview,
      contextUsage: result.contextUsage,
    };
  } catch (error) {
    if (error instanceof ProviderCancelledError) {
      const changeReview = await safeCollectChangeReview(changeSnapshot);
      db.addMessage(
        prepared.session.id,
        "assistant",
        "已中断",
        buildAssistantMetadata({
          provider: prepared.provider.type,
          events: opts.stream ? agentEvents : undefined,
          changeReview,
        }),
      );
      db.updateSession({
        id: prepared.session.id,
        title: prepared.session.title,
        sessionId: prepared.providerSessionId,
        provider: prepared.session.provider,
        updatedAt: Date.now(),
      });
      emitSessionsChanged(prepared.session.id, "assistant_message_cancelled");
      logger.info(`${opts.logPrefix}.cancelled`, {
        sessionId: prepared.session.id,
        source: prepared.source,
        provider: prepared.provider.type,
        ...(opts.logFields || {}),
      });
      await emitStream({ type: "cancelled", message: "已中断" });
      return {
        status: "cancelled",
        content: "已中断",
        title: prepared.session.title,
        sessionId: prepared.providerSessionId,
        provider: prepared.provider.type,
        changeReview,
      };
    }

    logger.error(`${opts.logPrefix}.failed`, {
      sessionId: prepared.session.id,
      source: prepared.source,
      error,
      ...(opts.logFields || {}),
    });
    await emitStream({
      type: "error",
      error: error instanceof Error ? error.message : "处理消息时出错了，请稍后再试。",
    });
    throw error;
  }
}

export async function runChatTurn(
  opts: PrepareChatTurnOptions & RunPreparedChatTurnOptions,
): Promise<ChatTurnResult> {
  const prepared = prepareChatTurn(opts);
  return runPreparedChatTurn(prepared, opts);
}

export async function compactChatSession(opts: {
  session: ChatSessionRecord;
  workdir?: string;
  modelId?: string;
  signal?: AbortSignal;
  logPrefix: string;
  logFields?: Record<string, unknown>;
}): Promise<CompactChatSessionResult> {
  const provider = getSessionProvider(opts.session);
  if (provider.type !== "claude-code") {
    throw new ChatTurnValidationError("当前只有 Claude Code 会话支持上下文压缩", 409);
  }
  if (!opts.session.sessionId) {
    throw new ChatTurnValidationError("当前会话还没有可压缩的 Claude Code 上下文", 409);
  }

  const command = provider.listSlashCommands?.().find((item) => item.id === "compact");
  if (!command) {
    throw new ChatTurnValidationError("当前 Provider 不支持上下文压缩", 409);
  }

  const workdir = opts.workdir || getWorkdir();
  const model = resolveRunModel(provider, opts.modelId);
  const sandbox = getSandbox();
  const prompt = command.command || "/compact";

  logger.info(`${opts.logPrefix}.start`, {
    sessionId: opts.session.id,
    providerSessionId: opts.session.sessionId,
    provider: provider.type,
    model,
    workdir,
    command: prompt,
    ...(opts.logFields || {}),
  });

  try {
    const result = await provider.run({
      workdir,
      sandbox,
      model,
      prompt,
      sessionId: opts.session.sessionId,
      rawProviderCommand: true,
      signal: opts.signal,
    });
    const providerSessionId = result.sessionId || opts.session.sessionId;
    const createdAt = Date.now();
    const content = "上下文已压缩";
    const metadata = JSON.stringify({
      contextCompact: {
        version: 1,
        provider: provider.type,
        command: prompt,
        contextUsage: result.contextUsage || null,
      },
    });
    const messageId = db.addMessage(opts.session.id, "assistant", content, metadata);

    db.updateSession({
      id: opts.session.id,
      title: opts.session.title,
      sessionId: providerSessionId,
      provider: opts.session.provider,
      updatedAt: createdAt,
    });
    opts.session.sessionId = providerSessionId;
    opts.session.updatedAt = createdAt;
    emitSessionsChanged(opts.session.id, "context_compacted");

    logger.info(`${opts.logPrefix}.success`, {
      sessionId: opts.session.id,
      providerSessionId,
      provider: provider.type,
      contextUsage: result.contextUsage || null,
      ...(opts.logFields || {}),
    });

    return {
      content,
      title: opts.session.title,
      messageId,
      createdAt,
      sessionId: providerSessionId,
      provider: provider.type,
      contextUsage: result.contextUsage,
    };
  } catch (error) {
    logger.error(`${opts.logPrefix}.failed`, {
      sessionId: opts.session.id,
      providerSessionId: opts.session.sessionId,
      provider: provider.type,
      error,
      ...(opts.logFields || {}),
    });
    throw error;
  }
}
