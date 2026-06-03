import {
  DWClient,
  EventAck,
  TOPIC_ROBOT,
} from "dingtalk-stream";
import type { DWClientDownStream } from "dingtalk-stream";

import type { ChannelCallbacks, DingtalkChannelConfig, IChannel } from "./types.js";
import { readChannelConfig, updateChannelConfig } from "./config.js";
import { sanitizeUserText } from "../message.js";
import { includeContentInLogs, logger, rawLogString } from "../logger.js";
import { handleCommand } from "./commands.js";

const MAX_HANDLED_IDS = 5000;
const DINGTALK_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const DINGTALK_MAX_TEXT_LENGTH = 3500;

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

interface DingtalkRobotMessage {
  conversationId?: string;
  conversationType?: string;
  msgId?: string;
  senderNick?: string;
  senderStaffId?: string;
  senderId?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  robotCode?: string;
  msgtype?: string;
  text?: {
    content?: string;
  };
}

interface DingtalkAccessTokenResponse {
  accessToken?: string;
  expireIn?: number;
  code?: string;
  message?: string;
  requestId?: string;
}

export class DingtalkChannel implements IChannel {
  readonly type = "dingtalk";

  private config: DingtalkChannelConfig | null = null;
  private client: DWClient | null = null;
  private callbacks: ChannelCallbacks | null = null;
  private handledMessageIds = new CappedSet<string>(MAX_HANDLED_IDS);
  private queueByChat = new Map<string, Promise<void>>();
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;
  private ownerSessionWebhook: string | null = null;

  async start(callbacks: ChannelCallbacks): Promise<boolean> {
    const config = readChannelConfig<DingtalkChannelConfig>("dingtalk");
    if (!config || !config.enabled) {
      logger.info("dingtalk.skipped", { reason: "disabled or missing config" });
      return false;
    }
    if (!config.appId || !config.appSecret) {
      logger.warn("dingtalk.skipped", { reason: "missing appId or appSecret" });
      return false;
    }

    this.config = config;
    this.callbacks = callbacks;

    const client = new DWClient({
      clientId: config.appId,
      clientSecret: config.appSecret,
      keepAlive: true,
      ua: "AnyBot",
    });
    this.client = client;

    client.registerCallbackListener(TOPIC_ROBOT, (event) => {
      this.ack(event);
      void this.handleRobotMessage(event).catch((error) => {
        logger.error("dingtalk.message.handle_failed", { error });
      });
    });

    await client.connect();
    logger.info("dingtalk.started");
    return true;
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
    }
    this.client = null;
    this.callbacks = null;
    this.config = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.ownerSessionWebhook = null;
    logger.info("dingtalk.stopped");
  }

  async sendToOwner(text: string): Promise<void> {
    if (!this.config) {
      throw new Error("DingTalk channel is not started");
    }
    if (!this.config.ownerChatId) {
      throw new Error("DingTalk ownerChatId 未配置，请先私聊机器人一次（会自动记录用户 ID），或在设置中手动填写");
    }
    if (!this.ownerSessionWebhook) {
      throw new Error("DingTalk 暂无可用 owner 会话，请先私聊机器人一次后再发送");
    }

    for (const chunk of this.splitMessage(text)) {
      await this.sendWebhookMarkdown(this.ownerSessionWebhook, chunk);
    }
  }

  private ack(event: DWClientDownStream): void {
    try {
      this.client?.socketCallBackResponse(event.headers.messageId, {
        status: EventAck.SUCCESS,
        message: "OK",
      });
    } catch (error) {
      logger.warn("dingtalk.ack_failed", {
        messageId: event.headers.messageId,
        error,
      });
    }
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

  private async handleRobotMessage(event: DWClientDownStream): Promise<void> {
    if (!this.config || !this.callbacks) return;

    const message = this.parseRobotMessage(event);
    if (!message) return;

    const messageId = message.msgId || event.headers.messageId;
    if (this.handledMessageIds.has(messageId)) return;
    this.handledMessageIds.add(messageId);

    const chatId = message.conversationId?.trim();
    if (!chatId) {
      logger.warn("dingtalk.message.no_conversation_id", { messageId });
      return;
    }

    logger.info("dingtalk.message.received", {
      messageId,
      chatId,
      conversationType: message.conversationType,
      msgtype: message.msgtype,
      senderStaffId: message.senderStaffId,
      robotCode: message.robotCode,
      ...(includeContentInLogs()
        ? { text: rawLogString(message.text?.content || "") }
        : {}),
    });

    if (message.conversationType === "1" && !this.config.ownerChatId && message.senderStaffId) {
      this.config.ownerChatId = message.senderStaffId;
      updateChannelConfig("dingtalk", { ownerChatId: message.senderStaffId });
      logger.info("dingtalk.owner_auto_saved", { ownerChatId: message.senderStaffId });
    }
    if (
      message.conversationType === "1" &&
      this.config.ownerChatId === message.senderStaffId &&
      message.sessionWebhook
    ) {
      this.ownerSessionWebhook = message.sessionWebhook;
    }

    if (message.msgtype !== "text") {
      if (message.sessionWebhook) {
        await this.sendWebhookMarkdown(message.sessionWebhook, "目前只支持文本消息。", message.senderStaffId);
      }
      return;
    }

    const userText = sanitizeUserText(message.text?.content || "");
    if (!userText) {
      if (message.sessionWebhook) {
        await this.sendWebhookMarkdown(message.sessionWebhook, "请直接发送文字问题。", message.senderStaffId);
      }
      return;
    }

    this.enqueueChatTask(chatId, async () => {
      if (!this.callbacks) return;

      const cmd = handleCommand(userText, chatId, "dingtalk", this.callbacks);
      if (cmd.handled) {
        if (cmd.reply) await this.sendReply(message, cmd.reply);
        return;
      }

      try {
        const reply = await this.callbacks.generateReply(
          chatId,
          userText,
          undefined,
          "dingtalk",
        );
        await this.sendReply(message, reply);
      } catch (error) {
        logger.error("dingtalk.text.failed", {
          messageId,
          chatId,
          error,
        });
        await this.sendReply(message, "处理消息时出错了，请稍后再试。");
      }
    });
  }

  private parseRobotMessage(event: DWClientDownStream): DingtalkRobotMessage | null {
    try {
      return JSON.parse(event.data) as DingtalkRobotMessage;
    } catch (error) {
      logger.warn("dingtalk.message.parse_failed", {
        messageId: event.headers.messageId,
        error,
      });
      return null;
    }
  }

  private async sendReply(message: DingtalkRobotMessage, text: string): Promise<void> {
    if (!message.sessionWebhook) {
      logger.warn("dingtalk.reply.skipped", {
        msgId: message.msgId,
        reason: "missing sessionWebhook",
      });
      return;
    }

    const atUserId = message.conversationType === "2" ? message.senderStaffId : undefined;
    for (const chunk of this.splitMessage(text)) {
      await this.sendWebhookMarkdown(message.sessionWebhook, chunk, atUserId);
    }
  }

  private splitMessage(text: string): string[] {
    if (text.length <= DINGTALK_MAX_TEXT_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= DINGTALK_MAX_TEXT_LENGTH) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", DINGTALK_MAX_TEXT_LENGTH);
      if (splitAt <= 0) splitAt = DINGTALK_MAX_TEXT_LENGTH;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }

  private async sendWebhookMarkdown(
    sessionWebhook: string,
    text: string,
    atUserId?: string,
  ): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(sessionWebhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          title: "AnyBot 回复",
          text,
        },
        ...(atUserId ? { at: { atUserIds: [atUserId], isAtAll: false } } : {}),
      }),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) {
      throw new Error(`DingTalk sessionWebhook failed: HTTP ${res.status} ${formatDingtalkError(data)}`);
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessTokenExpiresAtMs - now > 60_000) {
      return this.accessToken;
    }

    const res = await fetch(DINGTALK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: this.config!.appId,
        appSecret: this.config!.appSecret,
      }),
    });
    const data = await readJsonResponse(res) as DingtalkAccessTokenResponse;
    if (!res.ok || !data.accessToken) {
      throw new Error(`DingTalk accessToken failed: HTTP ${res.status} ${formatDingtalkError(data)}`);
    }

    const ttlSeconds = Math.max((data.expireIn || 7200) - 120, 60);
    this.accessToken = data.accessToken;
    this.accessTokenExpiresAtMs = now + ttlSeconds * 1000;
    return data.accessToken;
  }
}

async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatDingtalkError(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as {
    code?: string;
    message?: string;
    errcode?: number;
    errmsg?: string;
    raw?: string;
  };
  return obj.message || obj.errmsg || obj.code || obj.raw || JSON.stringify(data);
}
