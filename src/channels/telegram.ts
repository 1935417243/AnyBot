import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TelegramChannelConfig, IChannel, ChannelCallbacks } from "./types.js";
import { readChannelConfig } from "./config.js";
import { sanitizeUserText } from "../message.js";
import { includeContentInLogs, logger, rawLogString } from "../logger.js";

const shouldLogContent = includeContentInLogs();

const TELEGRAM_API = "https://api.telegram.org";
const POLL_TIMEOUT_SECS = 30;
const MAX_HANDLED_IDS = 5000;
const TG_MAX_MESSAGE_LENGTH = 4096;

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

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean; username?: string };
  text?: string;
  photo?: TelegramPhotoSize[];
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
  new_chat_members?: unknown[];
  left_chat_member?: unknown;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export class TelegramChannel implements IChannel {
  readonly type = "telegram";

  private config: TelegramChannelConfig | null = null;
  private callbacks: ChannelCallbacks | null = null;
  private handledUpdateIds = new CappedSet<number>(MAX_HANDLED_IDS);
  private queueByChat = new Map<string, Promise<void>>();
  private polling = false;
  private pollAbort: AbortController | null = null;
  private botUsername: string | null = null;

  async start(callbacks: ChannelCallbacks): Promise<void> {
    const config = readChannelConfig<TelegramChannelConfig>("telegram");
    if (!config || !config.enabled) {
      logger.info("telegram.skipped", { reason: "disabled or missing config" });
      return;
    }
    if (!config.token) {
      logger.warn("telegram.skipped", { reason: "missing token" });
      return;
    }

    this.config = config;
    this.callbacks = callbacks;

    try {
      const me = await this.apiCall("getMe");
      this.botUsername = me.username || null;
      logger.info("telegram.started", { username: this.botUsername });
    } catch (error) {
      logger.error("telegram.getMe_failed", { error });
      throw error;
    }

    this.polling = true;
    this.poll();
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
    this.callbacks = null;
    this.config = null;
    this.botUsername = null;
    logger.info("telegram.stopped");
  }

  private apiUrl(method: string): string {
    return `${TELEGRAM_API}/bot${this.config!.token}/${method}`;
  }

  private async apiCall(method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const options: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(this.apiUrl(method), options);
    const data = await res.json() as { ok: boolean; result?: any; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description || res.status}`);
    }
    return data.result;
  }

  private async poll(): Promise<void> {
    let offset = 0;

    while (this.polling) {
      try {
        this.pollAbort = new AbortController();
        const updates: TelegramUpdate[] = await this.apiCall(
          "getUpdates",
          { offset, timeout: POLL_TIMEOUT_SECS, allowed_updates: ["message"] },
          this.pollAbort.signal,
        );

        for (const update of updates) {
          offset = update.update_id + 1;

          if (this.handledUpdateIds.has(update.update_id)) continue;
          this.handledUpdateIds.add(update.update_id);

          if (update.message) {
            this.handleMessage(update.message);
          }
        }
      } catch (error: any) {
        if (error?.name === "AbortError") break;
        logger.error("telegram.poll_error", { error });
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private shouldReplyInGroup(message: TelegramMessage): boolean {
    if (!message.entities) return false;
    const text = message.text || "";
    return message.entities.some((e) => {
      if (e.type !== "bot_command" && e.type !== "mention") return false;
      const mention = text.slice(e.offset, e.offset + e.length);
      if (e.type === "mention" && this.botUsername) {
        return mention.toLowerCase() === `@${this.botUsername.toLowerCase()}`;
      }
      if (e.type === "bot_command" && this.botUsername) {
        return mention.includes(`@${this.botUsername}`);
      }
      return true;
    });
  }

  private stripBotMention(text: string): string {
    if (!this.botUsername) return text;
    return text.replace(new RegExp(`@${this.botUsername}`, "gi"), "").trim();
  }

  private enqueueChatTask(chatId: string, task: () => Promise<void>): void {
    const previous = this.queueByChat.get(chatId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.queueByChat.get(chatId) === next) {
          this.queueByChat.delete(chatId);
        }
      });
    this.queueByChat.set(chatId, next);
  }

  private handleMessage(message: TelegramMessage): void {
    if (message.from?.is_bot) return;
    if (message.new_chat_members || message.left_chat_member) return;

    const chatId = String(message.chat.id);
    const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";

    logger.info("telegram.message.received", {
      messageId: message.message_id,
      chatId,
      chatType: message.chat.type,
      hasPhoto: !!message.photo,
      ...(shouldLogContent ? { text: rawLogString(message.text || message.caption || "") } : {}),
    });

    if (message.photo) {
      if (isGroup && !this.shouldReplyInGroup(message)) return;
      void this.processPhotoMessage(chatId, message);
      return;
    }

    if (!message.text) return;

    if (isGroup && !this.shouldReplyInGroup(message)) return;

    const rawText = this.stripBotMention(message.text);
    const userText = sanitizeUserText(rawText);

    if (!userText) return;

    if (userText === "/new" || userText === "/reset" || userText === "/start") {
      this.callbacks!.resetSession(chatId, "telegram");
      this.enqueueChatTask(chatId, async () => {
        await this.sendText(chatId, "新窗口已开启，我们可以继续聊天了");
      });
      return;
    }

    const cleanText = userText.replace(/^\/\w+\s*/, "");
    if (!cleanText) return;

    this.enqueueChatTask(chatId, async () => {
      try {
        await this.apiCall("sendChatAction", { chat_id: message.chat.id, action: "typing" });
      } catch { /* best effort */ }

      try {
        const reply = await this.callbacks!.generateReply(chatId, cleanText, undefined, "telegram");
        await this.sendReply(chatId, reply);
      } catch (error) {
        logger.error("telegram.text.failed", {
          messageId: message.message_id,
          chatId,
          error,
        });
        await this.sendText(chatId, "处理消息时出错了，请稍后再试。");
      }
    });
  }

  private async processPhotoMessage(chatId: string, message: TelegramMessage): Promise<void> {
    this.enqueueChatTask(chatId, async () => {
      let imagePath: string | null = null;
      try {
        await this.apiCall("sendChatAction", { chat_id: message.chat.id, action: "typing" });
      } catch { /* best effort */ }

      try {
        const photos = message.photo!;
        const largest = photos[photos.length - 1];
        imagePath = await this.downloadFile(largest.file_id);

        const caption = message.caption
          ? sanitizeUserText(this.stripBotMention(message.caption))
          : "";
        const userText = caption ||
          "用户发来了一张图片。请先根据图片内容直接回答；如果缺少上下文，就先简要描述图片里有什么，并询问对方希望你进一步做什么。";

        const reply = await this.callbacks!.generateReply(chatId, userText, [imagePath], "telegram");
        await this.sendReply(chatId, reply);
      } catch (error) {
        logger.error("telegram.photo.failed", {
          messageId: message.message_id,
          chatId,
          error,
        });
        await this.sendText(chatId, "图片收到了，但处理失败，请稍后再试。");
      } finally {
        if (imagePath) {
          await rm(path.dirname(imagePath), { recursive: true, force: true }).catch(() => {});
        }
      }
    });
  }

  private async downloadFile(fileId: string): Promise<string> {
    const file = await this.apiCall("getFile", { file_id: fileId });
    const filePath: string = file.file_path;
    const url = `${TELEGRAM_API}/file/bot${this.config!.token}/${filePath}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download file: HTTP ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(filePath) || ".jpg";
    const dir = await mkdtemp(path.join(tmpdir(), "tg-img-"));
    const localPath = path.join(dir, `photo${ext}`);
    await writeFile(localPath, buffer);

    return localPath;
  }

  private async sendReply(chatId: string, text: string): Promise<void> {
    const chunks = this.splitMessage(text);
    for (const chunk of chunks) {
      await this.sendText(chatId, chunk);
    }
  }

  private splitMessage(text: string): string[] {
    if (text.length <= TG_MAX_MESSAGE_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= TG_MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", TG_MAX_MESSAGE_LENGTH);
      if (splitAt <= 0) splitAt = TG_MAX_MESSAGE_LENGTH;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }

  private async sendText(chatId: string, text: string): Promise<void> {
    try {
      await this.apiCall("sendMessage", {
        chat_id: Number(chatId),
        text,
        parse_mode: "Markdown",
      });
    } catch (error) {
      logger.warn("telegram.send.markdown_failed", { chatId, error });
      try {
        await this.apiCall("sendMessage", {
          chat_id: Number(chatId),
          text,
        });
      } catch (fallbackError) {
        logger.error("telegram.send.failed", { chatId, error: fallbackError });
      }
    }
  }
}
