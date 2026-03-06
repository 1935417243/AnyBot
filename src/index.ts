import "dotenv/config";

import { rm } from "node:fs/promises";
import path from "node:path";

import type { ChatTurn, SandboxMode } from "./types.js";
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
const codexPromptTemplateDir = process.env.CODEX_PROMPT_DIR;
const extraSystemPrompt = process.env.CODEX_SYSTEM_PROMPT;
const shouldLogContent = includeContentInLogs();
const shouldLogPrompt = includePromptInLogs();

if (!sandboxModes.includes(codexSandboxRaw as SandboxMode)) {
  throw new Error(
    `CODEX_SANDBOX 配置无效：${codexSandboxRaw}。可选值只有：${sandboxModes.join("、")}`,
  );
}

const codexSandbox = codexSandboxRaw as SandboxMode;

function getSystemPrompt(conversationText?: string): string {
  return buildSystemPrompt({
    workdir: codexWorkdir,
    sandbox: codexSandbox,
    extraPrompt: extraSystemPrompt,
    templateDir: codexPromptTemplateDir,
    conversationText,
  });
}

const { client: larkClient, wsClient, EventDispatcher } = createLarkClients(appId, appSecret);

// --- State with bounded memory ---

const MAX_HISTORY_TURNS = 12;
const MAX_HANDLED_IDS = 5000;
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

class CappedSet<T> {
  private set = new Set<T>();
  private queue: T[] = [];
  constructor(private capacity: number) {}

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

const historyByChat = new LRUMap<string, ChatTurn[]>(MAX_CHAT_SESSIONS);
const handledMessageIds = new CappedSet<string>(MAX_HANDLED_IDS);

// --- Core logic ---

function trimHistory(turns: ChatTurn[]): ChatTurn[] {
  return turns.slice(-MAX_HISTORY_TURNS);
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
  historyText = userText,
): Promise<string> {
  const history = historyByChat.get(chatId) || [];
  const promptContext = [...history.slice(-4), { role: "user" as const, content: historyText }]
    .map((turn) => turn.content)
    .join("\n");
  const systemPrompt = getSystemPrompt(promptContext);
  const transcript = [...history, { role: "user" as const, content: historyText }]
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n\n");
  const prompt = `${systemPrompt}

Conversation so far:
${transcript}

Reply to the latest USER message only.
When you create or reference an image that should be sent back to the user in Feishu, include the image file path in your final reply. Prefer an absolute path or Markdown image syntax like ![label](/absolute/path.png). Relative paths are resolved from the working directory.`;

  logger.info("reply.generate.start", {
    chatId,
    historyTurns: history.length,
    userTextChars: userText.length,
    historyTextChars: historyText.length,
    imageCount: imagePaths.length,
    systemPromptChars: systemPrompt.length,
    promptChars: prompt.length,
    ...(shouldLogContent
      ? {
          userText: rawLogString(userText),
          historyText: rawLogString(historyText),
          transcript: rawLogString(transcript),
        }
      : {}),
    ...(shouldLogPrompt
      ? {
          systemPrompt: rawLogString(systemPrompt),
          prompt: rawLogString(prompt),
        }
      : {}),
  });

  const outputText = await runCodex({
    bin: codexBin,
    workdir: codexWorkdir,
    sandbox: codexSandbox,
    model: codexModel,
    prompt,
    imagePaths,
  });

  const nextHistory = trimHistory([
    ...history,
    { role: "user", content: historyText },
    { role: "assistant", content: outputText },
  ]);
  historyByChat.set(chatId, nextHistory);

  logger.info("reply.generate.success", {
    chatId,
    replyChars: outputText.length,
    nextHistoryTurns: nextHistory.length,
    ...(shouldLogContent
      ? {
          replyText: rawLogString(outputText),
        }
      : {}),
  });

  return outputText;
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
    historyByChat.delete(message.chat_id);
    logger.info("message.text.new_window", {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    await sendText(larkClient, message.chat_id, "新窗口已开启");
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

  try {
    imagePath = await downloadImageFromMessage(larkClient, message);
    const userText =
      "用户发来了一张图片。请先根据图片内容直接回答；如果缺少上下文，就先简要描述图片里有什么，并询问对方希望你进一步做什么。";
    const reply = await generateReply(
      message.chat_id,
      userText,
      [imagePath],
      "[用户发送了一张图片，请结合图片内容回答。]",
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

async function main(): Promise<void> {
  logger.info("service.starting", {
    groupChatMode,
    ackReaction,
    codexBin,
    codexSandbox,
    codexModel: codexModel || null,
    codexWorkdir,
    promptTemplateDir: codexPromptTemplateDir || null,
    extraSystemPrompt: extraSystemPrompt ? "<set>" : null,
    logIncludeContent: shouldLogContent,
    logIncludePrompt: shouldLogPrompt,
  });
  await wsClient.start({ eventDispatcher: dispatcher });
  logger.info("service.started");
}

main().catch((error) => {
  logger.error("service.start_failed", { error });
  process.exit(1);
});
