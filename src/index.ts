import "dotenv/config";

import { createApp } from "./web/server.js";

import {
  initProvider,
  getProvider,
  ProviderTimeoutError,
  ProviderProcessError,
  ProviderEmptyOutputError,
} from "./providers/index.js";
import {
  includeContentInLogs,
  includePromptInLogs,
  logger,
  rawLogString,
} from "./logger.js";
import { getCurrentModel } from "./web/model-config.js";
import { startAllChannels } from "./channels/index.js";
import type { ChannelCallbacks } from "./channels/index.js";
import * as db from "./web/db.js";
import {
  buildFirstTurnPrompt,
  buildResumePrompt,
  generateId,
  generateTitle,
  getWorkdir,
  getSandbox,
} from "./shared.js";

const providerType = process.env.PROVIDER || "codex";

function getProviderConfig(type: string): Record<string, unknown> {
  switch (type) {
    case "codex":
      return { bin: process.env.CODEX_BIN };
    case "gemini-cli":
      return {
        bin: process.env.GEMINI_CLI_BIN,
        approvalMode: process.env.GEMINI_CLI_APPROVAL_MODE || "yolo",
      };
    default:
      return {};
  }
}

const provider = initProvider(providerType, getProviderConfig(providerType));

const shouldLogContent = includeContentInLogs();
const shouldLogPrompt = includePromptInLogs();

// --- State with bounded memory ---

const MAX_CHAT_SESSIONS = 200;

class LRUMap<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value!;
      this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): void {
    this.map.delete(key);
  }
}

const sessionIdByChat = new LRUMap<string, string>(MAX_CHAT_SESSIONS);
const sessionGenerationByChat = new Map<string, number>();

// --- Core logic ---

function getSessionGeneration(chatId: string): number {
  return sessionGenerationByChat.get(chatId) || 0;
}

function resetChatSession(chatId: string, source?: string): void {
  sessionIdByChat.delete(chatId);
  sessionGenerationByChat.set(chatId, getSessionGeneration(chatId) + 1);
  if (source) {
    db.detachChatId(source, chatId);
  }
}

function formatProviderError(error: unknown): string {
  if (error instanceof ProviderTimeoutError) {
    return "处理超时了，可能是问题太复杂。试试简化一下？";
  }
  if (error instanceof ProviderProcessError) {
    return "内部处理出错了，请稍后再试。";
  }
  if (error instanceof ProviderEmptyOutputError) {
    return "没有生成有效回复，请换个方式描述试试。";
  }
  return "处理消息时出错了，请稍后再试。";
}

function getOrCreateChannelSession(
  source: string,
  chatId: string,
): db.ChatSession {
  const existing = db.findSessionBySourceChat(source, chatId);
  if (existing) return existing;

  const session: db.ChatSession = {
    id: generateId(),
    title: "新对话",
    sessionId: null,
    source,
    chatId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.createSession(session);
  return session;
}

async function generateReply(
  chatId: string,
  userText: string,
  imagePaths: string[] = [],
  source: string = "unknown",
): Promise<string> {
  const sessionId = sessionIdByChat.get(chatId);
  const sessionGeneration = getSessionGeneration(chatId);
  const prompt = sessionId
    ? buildResumePrompt(userText)
    : buildFirstTurnPrompt(userText);

  const dbSession = getOrCreateChannelSession(source, chatId);
  db.addMessage(dbSession.id, "user", userText);

  if (dbSession.messages.length <= 1) {
    dbSession.title = generateTitle(userText);
  }

  logger.info("reply.generate.start", {
    chatId,
    source,
    provider: getProvider().type,
    mode: sessionId ? "resume" : "new",
    sessionId: sessionId || null,
    dbSessionId: dbSession.id,
    userTextChars: userText.length,
    imageCount: imagePaths.length,
    promptChars: prompt.length,
    ...(shouldLogContent ? { userText: rawLogString(userText) } : {}),
    ...(shouldLogPrompt ? { prompt: rawLogString(prompt) } : {}),
  });

  const result = await getProvider().run({
    workdir: getWorkdir(),
    sandbox: getSandbox(),
    model: getCurrentModel(),
    prompt,
    imagePaths,
    sessionId: sessionId || undefined,
  });

  if (result.sessionId && sessionGeneration === getSessionGeneration(chatId)) {
    sessionIdByChat.set(chatId, result.sessionId);
  }

  db.addMessage(dbSession.id, "assistant", result.text);
  db.updateSession({
    id: dbSession.id,
    title: dbSession.title,
    sessionId: result.sessionId || dbSession.sessionId,
    updatedAt: Date.now(),
  });

  logger.info("reply.generate.success", {
    chatId,
    source,
    provider: getProvider().type,
    sessionId: result.sessionId,
    dbSessionId: dbSession.id,
    replyChars: result.text.length,
    ...(shouldLogContent ? { replyText: rawLogString(result.text) } : {}),
  });

  return result.text;
}

// --- Channel callbacks ---

const channelCallbacks: ChannelCallbacks = {
  generateReply: (chatId, userText, imagePaths, source) =>
    generateReply(chatId, userText, imagePaths, source),
  resetSession: resetChatSession,
};

// --- Startup ---

const WEB_PORT = parseInt(process.env.WEB_PORT || "19981", 10);

async function main(): Promise<void> {
  logger.info("service.starting", {
    provider: provider.type,
    providerDisplayName: provider.displayName,
    model: getCurrentModel(),
    workdir: getWorkdir(),
    sandbox: getSandbox(),
    logIncludeContent: shouldLogContent,
    logIncludePrompt: shouldLogPrompt,
    webPort: WEB_PORT,
  });

  db.detachAllChannelSessions();
  logger.info("service.channel_sessions_detached");

  const webApp = createApp();
  webApp.listen(WEB_PORT, () => {
    logger.info("web.started", { port: WEB_PORT });
    console.log(`AnyBot Web UI: http://localhost:${WEB_PORT}`);
  });

  const channels = await startAllChannels(channelCallbacks);
  logger.info("service.started", {
    activeChannels: channels.map((c) => c.type),
  });
}

main().catch((error) => {
  logger.error("service.start_failed", { error });
  process.exit(1);
});
