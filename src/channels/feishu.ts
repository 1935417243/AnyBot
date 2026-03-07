import { rm } from "node:fs/promises";
import path from "node:path";

import type { FeishuChannelConfig, IChannel, ChannelCallbacks } from "./types.js";
import { readChannelConfig } from "./config.js";
import {
  createLarkClients,
  sendText,
  sendReply,
  sendAckReaction,
  downloadImageFromMessage,
} from "../lark.js";
import { parseIncomingText, sanitizeUserText } from "../message.js";
import { includeContentInLogs, logger, rawLogString } from "../logger.js";

import type * as Lark from "@larksuiteoapi/node-sdk";

const shouldLogContent = includeContentInLogs();

const MAX_HANDLED_IDS = 5000;

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

export class FeishuChannel implements IChannel {
  readonly type = "feishu";

  private config: FeishuChannelConfig | null = null;
  private larkClient: Lark.Client | null = null;
  private wsClient: ReturnType<typeof createLarkClients>["wsClient"] | null = null;
  private callbacks: ChannelCallbacks | null = null;
  private handledMessageIds = new CappedSet<string>(MAX_HANDLED_IDS);
  private queueByChat = new Map<string, Promise<void>>();
  private codexWorkdir = process.env.CODEX_WORKDIR || process.cwd();

  async start(callbacks: ChannelCallbacks): Promise<void> {
    const config = readChannelConfig<FeishuChannelConfig>("feishu");
    if (!config || !config.enabled) {
      logger.info("feishu.skipped", { reason: "disabled or missing config" });
      return;
    }
    if (!config.appId || !config.appSecret) {
      logger.warn("feishu.skipped", { reason: "missing appId or appSecret" });
      return;
    }

    this.config = config;
    this.callbacks = callbacks;

    const { client, wsClient, EventDispatcher } = createLarkClients(
      config.appId,
      config.appSecret,
    );
    this.larkClient = client;
    this.wsClient = wsClient;

    const dispatcher = new EventDispatcher({}).register({
      "im.message.receive_v1": (event: {
        sender: { sender_type: string };
        message: {
          message_id: string;
          chat_id: string;
          chat_type: string;
          message_type: string;
          content: string;
          mentions?: Array<{ id?: { open_id?: string } }>;
        };
      }) => this.handleMessage(event),
    });

    await wsClient.start({ eventDispatcher: dispatcher });
    logger.info("feishu.started", {
      groupChatMode: config.groupChatMode,
      ackReaction: config.ackReaction,
    });
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true });
      } catch (error) {
        logger.warn("feishu.ws_close_failed", { error });
      }
    }
    this.wsClient = null;
    this.larkClient = null;
    this.callbacks = null;
    this.config = null;
    logger.info("feishu.stopped");
  }

  private shouldReplyInGroup(
    mentions: Array<{ id?: { open_id?: string } }> = [],
  ): boolean {
    if (!this.config) return false;
    if (this.config.groupChatMode === "all") return true;
    if (this.config.botOpenId) {
      return mentions.some((m) => m.id?.open_id === this.config!.botOpenId);
    }
    return mentions.length > 0;
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

  private async handleMessage(event: {
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
    const client = this.larkClient!;
    const config = this.config!;

    logger.info("feishu.message.received", {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType: message.chat_type,
      messageType: message.message_type,
      senderType: sender.sender_type,
      mentionCount: message.mentions?.length || 0,
      ...(shouldLogContent
        ? { larkContent: rawLogString(message.content) }
        : {}),
    });

    if (sender.sender_type === "app") return;

    if (this.handledMessageIds.has(message.message_id)) return;
    this.handledMessageIds.add(message.message_id);

    if (message.message_type !== "text" && message.message_type !== "image") {
      await sendText(client, message.chat_id, "目前只支持文本和图片消息。");
      return;
    }

    if (
      message.chat_type === "group" ||
      message.chat_type === "group_chat"
    ) {
      if (!this.shouldReplyInGroup(message.mentions)) return;
    }

    if (message.message_type === "image") {
      void this.processImageMessage(client, config, message);
      return;
    }

    void this.processTextMessage(client, config, message);
  }

  private async processTextMessage(
    client: Lark.Client,
    config: FeishuChannelConfig,
    message: { message_id: string; chat_id: string; content: string },
  ): Promise<void> {
    const rawText = parseIncomingText(message.content);
    const userText = sanitizeUserText(rawText);

    if (!userText) {
      await sendText(client, message.chat_id, "请直接发送文字问题。");
      return;
    }

    if (userText === "/new") {
      this.callbacks!.resetSession(message.chat_id, "feishu");
      await sendText(client, message.chat_id, "新窗口已开启，我们可以继续聊天了");
      return;
    }

    try {
      await sendAckReaction(client, message.message_id, config.ackReaction);
    } catch (error) {
      logger.warn("feishu.ack_failed", {
        messageId: message.message_id,
        error,
      });
    }

    this.enqueueChatTask(message.chat_id, async () => {
      try {
        const reply = await this.callbacks!.generateReply(
          message.chat_id,
          userText,
          undefined,
          "feishu",
        );
        await sendReply(client, message.chat_id, reply, this.codexWorkdir);
      } catch (error) {
        logger.error("feishu.text.failed", {
          messageId: message.message_id,
          chatId: message.chat_id,
          error,
        });
        await sendText(client, message.chat_id, "处理消息时出错了，请稍后再试。");
      }
    });
  }

  private async processImageMessage(
    client: Lark.Client,
    config: FeishuChannelConfig,
    message: {
      message_id: string;
      chat_id: string;
      message_type: string;
      content: string;
    },
  ): Promise<void> {
    try {
      await sendAckReaction(client, message.message_id, config.ackReaction);
    } catch (error) {
      logger.warn("feishu.ack_failed", {
        messageId: message.message_id,
        error,
      });
    }

    let imagePath: string | null = null;

    this.enqueueChatTask(message.chat_id, async () => {
      try {
        imagePath = await downloadImageFromMessage(client, message);
        const userText =
          "用户发来了一张图片。请先根据图片内容直接回答；如果缺少上下文，就先简要描述图片里有什么，并询问对方希望你进一步做什么。";
        const reply = await this.callbacks!.generateReply(
          message.chat_id,
          userText,
          [imagePath],
          "feishu",
        );
        await sendReply(client, message.chat_id, reply, this.codexWorkdir);
      } catch (error) {
        logger.error("feishu.image.failed", {
          messageId: message.message_id,
          chatId: message.chat_id,
          error,
        });
        await sendText(
          client,
          message.chat_id,
          "图片收到了，但处理失败。请确认机器人有读取图片资源的权限后再试。",
        );
      } finally {
        if (imagePath) {
          await rm(path.dirname(imagePath), {
            recursive: true,
            force: true,
          }).catch(() => {});
        }
      }
    });
  }
}
