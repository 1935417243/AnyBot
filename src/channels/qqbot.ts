import type { QQBotChannelConfig, IChannel, ChannelCallbacks } from "./types.js";
import { readChannelConfig, updateChannelConfig } from "./config.js";
import { logger } from "../logger.js";
import { sanitizeUserText } from "../message.js";
import { handleCommand } from "./commands.js";
import WebSocket from "ws";

const QQ_OAUTH_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_GATEWAY_URL = "https://api.sgroup.qq.com/gateway";
const QQ_BASE_API = "https://api.sgroup.qq.com";
const QQ_TEXT_MSG_TYPE = 0;
const QQ_MARKDOWN_MSG_TYPE = 2;

export class QQBotChannel implements IChannel {
  readonly type = "qqbot";

  private config: QQBotChannelConfig | null = null;
  private callbacks: ChannelCallbacks | null = null;
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastSeq: number | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private queueByChat = new Map<string, Promise<void>>();

  async start(callbacks: ChannelCallbacks): Promise<boolean> {
    const config = readChannelConfig<QQBotChannelConfig>("qqbot");
    if (!config || !config.enabled) {
      logger.info("qqbot.skipped", { reason: "disabled or missing config" });
      return false;
    }
    if (!config.appId || !config.appSecret) {
      logger.warn("qqbot.skipped", { reason: "missing appId or appSecret" });
      return false;
    }

    this.config = config;
    this.callbacks = callbacks;
    
    try {
      await this.connect();
      return true;
    } catch (e) {
      logger.error("qqbot.start_failed", { error: e });
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        logger.warn("qqbot.ws_close_failed", { error });
      }
      this.ws = null;
    }
    this.callbacks = null;
    this.config = null;
    logger.info("qqbot.stopped");
  }

  private async getValidToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.accessToken;
    }
    
    logger.info("qqbot.fetching_token", { appId: this.config!.appId });
    const response = await fetch(QQ_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        appId: this.config!.appId, 
        clientSecret: this.config!.appSecret 
      })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch AccessToken: HTTP ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    if (!data.access_token) {
      throw new Error(`Failed to get access_token: body is missing token`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    logger.info("qqbot.token_fetched");
    return this.accessToken;
  }

  private async connect(): Promise<void> {
    const token = await this.getValidToken();

    const gwRes = await fetch(QQ_GATEWAY_URL, {
      headers: { "Authorization": `QQBot ${token}` }
    });
    
    if (!gwRes.ok) {
        throw new Error(`Failed to fetch gateway: HTTP ${gwRes.status}`);
    }
    
    const gwData = await gwRes.json() as { url: string };
    const wsUrl = gwData.url;

    logger.info("qqbot.ws_connecting", { url: wsUrl });

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      logger.info("qqbot.ws_opened");
    });

    this.ws.on("message", (data: any) => {
      const payloadString = data.toString();
      let payload: any;
      try {
          payload = JSON.parse(payloadString);
      } catch (e) {
          return;
      }
      
      if (payload.s) {
          this.lastSeq = payload.s;
      }

      const op = payload.op;
      const t = payload.t;

      if (op === 10) {
        // Hello
        const interval = payload.d.heartbeat_interval;
        logger.info("qqbot.ws_hello", { heartbeatInterval: interval });
        
        // 发送 Identify, 请求公域与频道的普通消息以及私信
        this.ws!.send(JSON.stringify({
          op: 2,
          d: {
            token: `QQBot ${this.accessToken}`,
            intents: (1 << 30) | (1 << 12) | (1 << 25), // PUBLIC_GUILD_MESSAGES, DIRECT_MESSAGE, GROUP_AND_C2C
            shard: [0, 1]
          }
        }));

        this.heartbeatInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
          }
        }, interval);
      } else if (op === 0 && t === "READY") {
        logger.info("qqbot.started", { user: payload.d.user });
      } else if (op === 0 && (t === "DIRECT_MESSAGE_CREATE" || t === "AT_MESSAGE_CREATE" || t === "GROUP_AT_MESSAGE_CREATE" || t === "C2C_MESSAGE_CREATE")) {
        // 处理消息事件
        this.handleMessage(payload.d, t);
      } else if (op === 9) {
        logger.error("qqbot.ws_invalid_session");
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      logger.warn("qqbot.ws_closed", { code, reason: reason.toString() });
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      // TODO: 添加断线重连逻辑
    });
    
    this.ws.on("error", (error: Error) => {
      logger.error("qqbot.ws_error", { error });
    });
  }

  async sendToOwner(text: string): Promise<void> {
    if (!this.config) {
      throw new Error("QQBot channel is not started");
    }
    const ownerChatId = this.config.ownerChatId;
    if (!ownerChatId) {
      throw new Error("QQBot ownerChatId 未配置，请先私聊机器人一次（会自动记录），或在设置中手动填写");
    }
    try {
      const url = `${QQ_BASE_API}/v2/users/${ownerChatId}/messages`;
      await this.sendMessageWithMarkdownFallback(url, text, "C2C_MESSAGE_CREATE");
      logger.info("qqbot.send_to_owner.success", { ownerChatId });
    } catch (e) {
      logger.error("qqbot.send_to_owner.error", { error: e });
      throw e;
    }
  }

  private async handleMessage(message: any, eventType: string): Promise<void> {
    // 频道和单聊里的作者ID是不一样的字段结构
    let chatId = message.guild_id || message.channel_id || message.author?.id;
    
    // 群聊（新版群助手）
    if (message.group_openid) {
        chatId = message.group_openid;
    }
    
    if (!chatId) {
        logger.warn("qqbot.message.no_chat_id", { message });
        return;
    }

    if (eventType === "C2C_MESSAGE_CREATE" && !this.config!.ownerChatId) {
      const userId = message.author?.user_openid || chatId;
      this.config!.ownerChatId = userId;
      updateChannelConfig("qqbot", { ownerChatId: userId });
      logger.info("qqbot.owner_auto_saved", { chatId: userId });
    }

    logger.info("qqbot.message.received", {
      messageId: message.id,
      chatId,
      eventType
    });

    const rawText = message.content || "";
    // 如果是频道被@或者是群里被@的消息，最好能过滤掉类似 `<@!1234>` 的本身
    const userText = sanitizeUserText(rawText).replace(/<@!\d+>/g, "").trim();

    if (!userText) {
      return;
    }

    this.enqueueChatTask(chatId, async () => {
      const cmd = handleCommand(userText, chatId, "qqbot", this.callbacks!);
      if (cmd.handled) {
        if (cmd.reply) await this.sendText(chatId, message.id, cmd.reply, eventType);
        return;
      }

      try {
        const reply = await this.callbacks!.generateReply(
          chatId,
          userText,
          undefined,
          "qqbot"
        );
        await this.sendText(chatId, message.id, reply, eventType);
      } catch (error) {
        logger.error("qqbot.text.failed", {
          messageId: message.id,
          chatId: chatId,
          error,
        });
        await this.sendText(chatId, message.id, "处理消息时出错了，请稍后再试。", eventType);
      }
    });
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

  private async sendText(chatId: string, msgId: string, text: string, eventType: string): Promise<void> {
    try {
      let url = "";

      // 新版直接发群聊
      if (eventType === "GROUP_AT_MESSAGE_CREATE") {
          url = `${QQ_BASE_API}/v2/groups/${chatId}/messages`;
      } 
      // 新版直接发C2C（好友）
      else if (eventType === "C2C_MESSAGE_CREATE") {
          url = `${QQ_BASE_API}/v2/users/${chatId}/messages`;
      } 
      // 频道私信
      else if (eventType === "DIRECT_MESSAGE_CREATE") {
          // 这里如果是频道主动发起的私信，chatId通常是 guild_id 或者发过来的 dm_channelId
          // 为了简化，目前依然用 /dms 或者 /channels/${chatId}/messages 如果chatId是频道的channel
          url = `${QQ_BASE_API}/dms/${chatId}/messages`; 
          // 实际上如果创建了DM频道，chatId就是dm频道的id
      }
      // 频道被艾特
      else {
          url = `${QQ_BASE_API}/channels/${chatId}/messages`;
      }

      logger.info("qqbot.send_text.start", { chatId, url });
      await this.sendMessageWithMarkdownFallback(url, text, eventType, msgId);
      logger.info("qqbot.send_text.success", { chatId });
    } catch (e) {
      logger.error("qqbot.send_text.failed", { error: e });
    }
  }

  private async sendMessageWithMarkdownFallback(
    url: string,
    text: string,
    eventType: string,
    msgId?: string,
  ): Promise<void> {
    try {
      await this.postMessage(url, buildQQMarkdownBody(text, eventType, msgId));
      logger.info("qqbot.send_markdown.success", { url, eventType });
    } catch (error) {
      logger.warn("qqbot.send_markdown.failed_fallback_text", { url, eventType, error });
      await this.postMessage(url, buildQQTextBody(text, eventType, msgId));
    }
  }

  private async postMessage(url: string, body: Record<string, unknown>): Promise<void> {
    const token = await this.getValidToken();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `QQBot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseData = await readJsonResponse(res);
    if (!res.ok) {
      logger.error("qqbot.send_message.failed_http", { status: res.status, response: responseData });
      throw new Error(`QQ send failed: HTTP ${res.status}`);
    }
  }
}

function buildQQMarkdownBody(text: string, eventType: string, msgId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    markdown: { content: text },
  };
  if (msgId) {
    body.msg_id = msgId;
  }
  if (usesV2MessageBody(eventType)) {
    body.msg_type = QQ_MARKDOWN_MSG_TYPE;
  }
  return body;
}

function buildQQTextBody(text: string, eventType: string, msgId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content: text,
  };
  if (msgId) {
    body.msg_id = msgId;
  }
  if (usesV2MessageBody(eventType)) {
    body.msg_type = QQ_TEXT_MSG_TYPE;
  }
  return body;
}

function usesV2MessageBody(eventType: string): boolean {
  return eventType === "GROUP_AT_MESSAGE_CREATE" || eventType === "C2C_MESSAGE_CREATE";
}

async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
