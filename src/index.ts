import "dotenv/config";

import { rm } from "node:fs/promises";
import path from "node:path";
import { createApp } from "./web/server.js";

import type { SandboxMode } from "./types.js";
import { sandboxModes } from "./types.js";
import { parseIncomingText, sanitizeUserText } from "./message.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  runCodex,
  CodexTimeoutError,
  CodexProcessError,
  CodexEmptyOutputError,
} from "./codex.js";
import {
  createLarkClients,
  sendText,
  sendReply,
  sendAckReaction,
  downloadImageFromMessage,
} from "./lark.js";
import {
  includeContentInLogs,
  includePromptInLogs,
  logger,
  rawLogString,
} from "./logger.js";

const requiredEnv = ["FEISHU_APP_ID", "FEISHU_APP_SECRET"] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`缺少必填环境变量：${key}`);
  }
}

const appId = process.env.FEISHU_APP_ID as string;
const appSecret = process.env.FEISHU_APP_SECRET as string;
const groupChatMode = process.env.FEISHU_GROUP_CHAT_MODE || "mention";
const botOpenId = process.env.FEISHU_BOT_OPEN_ID;
const ackReaction = process.env.FEISHU_ACK_REACTION || "OK";
const codexBin = process.env.CODEX_BIN || "codex";
const codexSandboxRaw = process.env.CODEX_SANDBOX || "read-only";
const codexModel = process.env.CODEX_MODEL;
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

const { client: larkClient, wsClient, EventDispatcher } = createLarkClients(appId, appSecret);

// --- State with bounded memory ---

const MAX_HANDLED_IDS = 5000;
const MAX_CHAT_SESSIONS = 200;

class LRUMap<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) { }

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

class CappedSet<T> {
  private set = new Set<T>();
  private queue: T[] = [];
  constructor(private capacity: number) { }

  has(value: T): boolean {
    return this.set.has(value);
  }

  add(value: T): void {
    if (this.set.has(value)) return;
    if (this.set.size >= this.capacity) {
      const oldest = this.queue.shift()!;
      this.set.delete(oldest);
    }
    this.set.add(value);
    this.queue.push(value);
  }
}

const sessionIdByChat = new LRUMap<string, string>(MAX_CHAT_SESSIONS);
const sessionGenerationByChat = new Map<string, number>();
const queueByChat = new Map<string, Promise<void>>();
const handledMessageIds = new CappedSet<string>(MAX_HANDLED_IDS);

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

function enqueueChatTask(chatId: string, task: () => Promise<void>): void {
  const previous = queueByChat.get(chatId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (queueByChat.get(chatId) === next) {
        queueByChat.delete(chatId);
      }
    });
  queueByChat.set(chatId, next);
}

function getSessionGeneration(chatId: string): number {
  return sessionGenerationByChat.get(chatId) || 0;
}

function resetChatSession(chatId: string): void {
  sessionIdByChat.delete(chatId);
  sessionGenerationByChat.set(chatId, getSessionGeneration(chatId) + 1);
}

function shouldReplyInGroup(
  mentions: Array<{ id?: { open_id?: string } }> = [],
): boolean {
  if (groupChatMode === "all") return true;
  if (botOpenId) return mentions.some((m) => m.id?.open_id === botOpenId);
  return mentions.length > 0;
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

async function generateReply(
  chatId: string,
  userText: string,
  imagePaths: string[] = [],
): Promise<string> {
  const sessionId = sessionIdByChat.get(chatId);
  const sessionGeneration = getSessionGeneration(chatId);
  const prompt = sessionId
    ? buildResumePrompt(userText)
    : buildFirstTurnPrompt(userText);

  logger.info("reply.generate.start", {
    chatId,
    mode: sessionId ? "resume" : "new",
    sessionId: sessionId || null,
    userTextChars: userText.length,
    imageCount: imagePaths.length,
    promptChars: prompt.length,
    ...(shouldLogContent
      ? {
        userText: rawLogString(userText),
      }
      : {}),
    ...(shouldLogPrompt
      ? {
        prompt: rawLogString(prompt),
      }
      : {}),
  });

  const result = await runCodex({
    bin: codexBin,
    workdir: codexWorkdir,
    sandbox: codexSandbox,
    model: codexModel,
    prompt,
    imagePaths,
    sessionId: sessionId || undefined,
  });

  if (result.sessionId && sessionGeneration === getSessionGeneration(chatId)) {
    sessionIdByChat.set(chatId, result.sessionId);
  }

  logger.info("reply.generate.success", {
    chatId,
    sessionId: result.sessionId,
    replyChars: result.text.length,
    ...(shouldLogContent
      ? {
        replyText: rawLogString(result.text),
      }
      : {}),
  });

  return result.text;
}

// --- Message handlers ---

async function processTextMessage(message: {
  message_id: string;
  chat_id: string;
  content: string;
}): Promise<void> {
  const rawText = parseIncomingText(message.content);
  const userText = sanitizeUserText(rawText);

  logger.info("message.text.received", {
    messageId: message.message_id,
    chatId: message.chat_id,
    rawTextChars: rawText.length,
    userTextChars: userText.length,
    ...(shouldLogContent
      ? {
        larkContent: rawLogString(message.content),
        rawText: rawLogString(rawText),
        userText: rawLogString(userText),
      }
      : {}),
  });

  if (!userText) {
    logger.warn("message.text.empty", {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    await sendText(larkClient, message.chat_id, "请直接发送文字问题。");
    return;
  }

  if (userText === "/new") {
    resetChatSession(message.chat_id);
    logger.info("message.text.new_window", {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    await sendText(larkClient, message.chat_id, "新窗口已开启，我们可以继续聊天了");
    return;
  }

  try {
    await sendAckReaction(larkClient, message.message_id, ackReaction);
  } catch (error) {
    logger.warn("message.ack_failed", {
      messageId: message.message_id,
      chatId: message.chat_id,
      error,
    });
  }

  enqueueChatTask(message.chat_id, async () => {
    try {
      const reply = await generateReply(message.chat_id, userText);
      await sendReply(larkClient, message.chat_id, reply, codexWorkdir);
    } catch (error) {
      logger.error("message.text.failed", {
        messageId: message.message_id,
        chatId: message.chat_id,
        error,
      });
      await sendText(larkClient, message.chat_id, formatCodexError(error));
    }
  });
}

async function processImageMessage(message: {
  message_id: string;
  chat_id: string;
  message_type: string;
  content: string;
}): Promise<void> {
  logger.info("message.image.received", {
    messageId: message.message_id,
    chatId: message.chat_id,
    messageType: message.message_type,
    ...(shouldLogContent
      ? {
        larkContent: rawLogString(message.content),
      }
      : {}),
  });

  try {
    await sendAckReaction(larkClient, message.message_id, ackReaction);
  } catch (error) {
    logger.warn("message.ack_failed", {
      messageId: message.message_id,
      chatId: message.chat_id,
      error,
    });
  }

  let imagePath: string | null = null;

  enqueueChatTask(message.chat_id, async () => {
    try {
      imagePath = await downloadImageFromMessage(larkClient, message);
      const userText =
        "用户发来了一张图片。请先根据图片内容直接回答；如果缺少上下文，就先简要描述图片里有什么，并询问对方希望你进一步做什么。";
      const reply = await generateReply(
        message.chat_id,
        userText,
        [imagePath],
      );
      await sendReply(larkClient, message.chat_id, reply, codexWorkdir);
    } catch (error) {
      logger.error("message.image.failed", {
        messageId: message.message_id,
        chatId: message.chat_id,
        error,
      });
      await sendText(
        larkClient,
        message.chat_id,
        "图片收到了，但处理失败。请确认机器人有读取图片资源的权限后再试。",
      );
    } finally {
      if (imagePath) {
        await rm(path.dirname(imagePath), { recursive: true, force: true }).catch(
          (cleanupError) => {
            logger.warn("message.image.cleanup_failed", {
              messageId: message.message_id,
              chatId: message.chat_id,
              imagePath,
              error: cleanupError,
            });
          },
        );
      }
    }
  });
}

// --- Event dispatch ---

async function handleMessage(event: {
  sender: { sender_type: string };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{ id?: { open_id?: string } }>;
  };
}): Promise<void> {
  const { sender, message } = event;

  logger.info("message.received", {
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type,
    messageType: message.message_type,
    senderType: sender.sender_type,
    mentionCount: message.mentions?.length || 0,
    ...(shouldLogContent
      ? {
        larkContent: rawLogString(message.content),
      }
      : {}),
  });

  if (sender.sender_type === "app") {
    logger.debug("message.skipped.app_sender", {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    return;
  }

  if (handledMessageIds.has(message.message_id)) {
    logger.debug("message.skipped.duplicate", {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    return;
  }
  handledMessageIds.add(message.message_id);

  if (message.message_type !== "text" && message.message_type !== "image") {
    logger.warn("message.unsupported_type", {
      messageId: message.message_id,
      chatId: message.chat_id,
      messageType: message.message_type,
    });
    await sendText(larkClient, message.chat_id, "目前只支持文本和图片消息。");
    return;
  }

  if (message.chat_type === "group" || message.chat_type === "group_chat") {
    if (!shouldReplyInGroup(message.mentions)) {
      logger.debug("message.skipped.group_filter", {
        messageId: message.message_id,
        chatId: message.chat_id,
        mentionCount: message.mentions?.length || 0,
        groupChatMode,
        botOpenId: botOpenId || null,
      });
      return;
    }
  }

  if (message.message_type === "image") {
    void processImageMessage(message);
    return;
  }

  void processTextMessage(message);
}

const dispatcher = new EventDispatcher({}).register({
  "im.message.receive_v1": handleMessage,
});

const WEB_PORT = parseInt(process.env.WEB_PORT || "19981", 10);

async function main(): Promise<void> {
  logger.info("service.starting", {
    groupChatMode,
    ackReaction,
    codexBin,
    codexSandbox,
    codexModel: codexModel || null,
    codexWorkdir,
    extraSystemPrompt: extraSystemPrompt ? "<set>" : null,
    logIncludeContent: shouldLogContent,
    logIncludePrompt: shouldLogPrompt,
    webPort: WEB_PORT,
  });

  const webApp = createApp();
  webApp.listen(WEB_PORT, () => {
    logger.info("web.started", { port: WEB_PORT });
    console.log(`Codex Web UI: http://localhost:${WEB_PORT}`);
  });

  await wsClient.start({ eventDispatcher: dispatcher });
  logger.info("service.started");
}

main().catch((error) => {
  logger.error("service.start_failed", { error });
  process.exit(1);
});
