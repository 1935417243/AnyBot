import "dotenv/config";

import { createApp } from "./web/server.js";

import type { SandboxMode } from "./types.js";
import { sandboxModes } from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  runCodex,
  CodexTimeoutError,
  CodexProcessError,
  CodexEmptyOutputError,
} from "./codex.js";
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

const codexBin = process.env.CODEX_BIN || "codex";
const codexSandboxRaw = process.env.CODEX_SANDBOX || "read-only";
const codexWorkdir = process.env.CODEX_WORKDIR || process.cwd();
const extraSystemPrompt = process.env.CODEX_SYSTEM_PROMPT;
const shouldLogContent = includeContentInLogs();
const shouldLogPrompt = includePromptInLogs();

if (!sandboxModes.includes(codexSandboxRaw as SandboxMode)) {
  throw new Error(
    `CODEX_SANDBOX 配置无效：${codexSandboxRaw}。可选值只有：${sandboxModes.join("、")}`,
  );
}

const codexSandbox = codexSandboxRaw as SandboxMode;

function getSystemPrompt(): string {
  return buildSystemPrompt({
    workdir: codexWorkdir,
    sandbox: codexSandbox,
    extraPrompt: extraSystemPrompt,
  });
}

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

const outputContract = [
  "只回复当前这条用户消息。",
  "如果需要发送图片给用户，在回复中包含图片绝对路径或 Markdown 图片语法 ![描述](/绝对路径.png)。相对路径基于工作目录解析。",
  "如果需要发送非图片文件，每个文件单独一行，格式：FILE: /绝对路径/文件名.扩展名。",
].join("\n");

function buildFirstTurnPrompt(userText: string): string {
  return `${getSystemPrompt()}

输出要求：
${outputContract}

用户消息：
${userText}`;
}

function buildResumePrompt(userText: string): string {
  return `${userText}

补充要求：
${outputContract}`;
}

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

function formatCodexError(error: unknown): string {
  if (error instanceof CodexTimeoutError) {
    return "处理超时了，可能是问题太复杂。试试简化一下？";
  }
  if (error instanceof CodexProcessError) {
    return "内部处理出错了，请稍后再试。";
  }
  if (error instanceof CodexEmptyOutputError) {
    return "没有生成有效回复，请换个方式描述试试。";
  }
  return "处理消息时出错了，请稍后再试。";
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTitle(text: string): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > 20 ? clean.slice(0, 20) + "…" : clean;
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
    mode: sessionId ? "resume" : "new",
    sessionId: sessionId || null,
    dbSessionId: dbSession.id,
    userTextChars: userText.length,
    imageCount: imagePaths.length,
    promptChars: prompt.length,
    ...(shouldLogContent ? { userText: rawLogString(userText) } : {}),
    ...(shouldLogPrompt ? { prompt: rawLogString(prompt) } : {}),
  });

  const result = await runCodex({
    bin: codexBin,
    workdir: codexWorkdir,
    sandbox: codexSandbox,
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
    codexBin,
    codexSandbox,
    codexModel: getCurrentModel(),
    codexWorkdir,
    extraSystemPrompt: extraSystemPrompt ? "<set>" : null,
    logIncludeContent: shouldLogContent,
    logIncludePrompt: shouldLogPrompt,
    webPort: WEB_PORT,
  });

  db.detachAllChannelSessions();
  logger.info("service.channel_sessions_detached");

  const webApp = createApp();
  webApp.listen(WEB_PORT, () => {
    logger.info("web.started", { port: WEB_PORT });
    console.log(`Codex Web UI: http://localhost:${WEB_PORT}`);
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
