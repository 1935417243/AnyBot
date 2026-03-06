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
    templateDir: codexPromptTemplateDir,
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
  const systemPrompt = getSystemPrompt();
  const transcript = [...history, { role: "user" as const, content: historyText }]
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n\n");
  const prompt = `${systemPrompt}

Conversation so far:
${transcript}

Reply to the latest USER message only.
When you create or reference an image that should be sent back to the user in Feishu, include the image file path in your final reply. Prefer an absolute path or Markdown image syntax like ![label](/absolute/path.png). Relative paths are resolved from the working directory.`;

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

  if (!userText) {
    await sendText(larkClient, message.chat_id, "请直接发送文字问题。");
    return;
  }

  try {
    await sendAckReaction(larkClient, message.message_id, ackReaction);
  } catch (error) {
    console.error("发送已收到 reaction 失败", error);
  }

  try {
    const reply = await generateReply(message.chat_id, userText);
    await sendReply(larkClient, message.chat_id, reply, codexWorkdir);
  } catch (error) {
    console.error("处理消息失败", error);
    await sendText(larkClient, message.chat_id, formatCodexError(error));
  }
}

async function processImageMessage(message: {
  message_id: string;
  chat_id: string;
  message_type: string;
  content: string;
}): Promise<void> {
  try {
    await sendAckReaction(larkClient, message.message_id, ackReaction);
  } catch (error) {
    console.error("发送已收到 reaction 失败", error);
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
    console.error("处理图片消息失败", error);
    await sendText(
      larkClient,
      message.chat_id,
      "图片收到了，但处理失败。请确认机器人有读取图片资源的权限后再试。",
    );
  } finally {
    if (imagePath) {
      await rm(path.dirname(imagePath), { recursive: true, force: true }).catch(
        (cleanupError) => {
          console.error("清理临时图片失败", cleanupError);
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

  if (sender.sender_type === "app") return;

  if (handledMessageIds.has(message.message_id)) return;
  handledMessageIds.add(message.message_id);

  if (message.message_type !== "text" && message.message_type !== "image") {
    await sendText(larkClient, message.chat_id, "目前只支持文本和图片消息。");
    return;
  }

  if (message.chat_type === "group" || message.chat_type === "group_chat") {
    if (!shouldReplyInGroup(message.mentions)) return;
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
  console.log("正在启动飞书机器人桥接服务...");
  await wsClient.start({ eventDispatcher: dispatcher });
  console.log("飞书机器人桥接服务已启动。");
}

main().catch((error) => {
  console.error("启动失败", error);
  process.exit(1);
});
