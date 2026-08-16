import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { QQBotChannelConfig, IChannel, ChannelCallbacks } from "./types.js";
import { readChannelConfig, updateChannelConfig } from "./config.js";
import { logger } from "../logger.js";
import {
  getImageExtension,
  isSupportedImagePath,
  parseReplyPayload,
  sanitizeUserText,
} from "../message.js";
import { handleCommand } from "./commands.js";
import { getWorkdir } from "../shared.js";
import WebSocket from "ws";

const QQ_OAUTH_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_GATEWAY_URL = "https://api.sgroup.qq.com/gateway";
const QQ_BASE_API = "https://api.sgroup.qq.com";
const QQ_TEXT_MSG_TYPE = 0;
const QQ_MARKDOWN_MSG_TYPE = 2;
const QQ_MEDIA_MSG_TYPE = 7;
const QQ_IMAGE_FILE_TYPE = 1;
const QQ_MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const QQ_MAX_INCOMING_ATTACHMENT_BYTES = 50 * 1024 * 1024;

interface QQAttachment {
  id?: string;
  filename?: string;
  content_type?: string;
  url?: string;
  size?: number;
  height?: number;
  width?: number;
}

interface DownloadedQQMedia {
  imagePaths: string[];
  filePaths: Array<{ name: string; path: string }>;
  tempDir: string | null;
}

interface QQMediaUploadResponse {
  file_info?: string;
  [key: string]: unknown;
}

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
      try {
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
          const interval = payload.d?.heartbeat_interval;
          if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
            logger.warn("qqbot.ws_hello_invalid", { payload: payloadString.slice(0, 200) });
            return;
          }
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
          logger.info("qqbot.started", { user: payload.d?.user });
        } else if (op === 0 && (t === "DIRECT_MESSAGE_CREATE" || t === "AT_MESSAGE_CREATE" || t === "GROUP_AT_MESSAGE_CREATE" || t === "C2C_MESSAGE_CREATE")) {
          // 处理消息事件
          this.handleMessage(payload.d, t).catch((error) => {
            logger.error("qqbot.handle_message_failed", { error, eventType: t });
          });
        } else if (op === 9) {
          logger.error("qqbot.ws_invalid_session");
        }
      } catch (error) {
        logger.error("qqbot.ws_message_error", { error });
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
      await this.sendReply(ownerChatId, undefined, text, "C2C_MESSAGE_CREATE");
      logger.info("qqbot.send_to_owner.success", { ownerChatId });
    } catch (e) {
      logger.error("qqbot.send_to_owner.error", { error: e });
      throw e;
    }
  }

  private async handleMessage(message: any, eventType: string): Promise<void> {
    // 频道和单聊里的作者ID是不一样的字段结构
    let chatId = message.guild_id || message.channel_id || message.author?.id;

    if (eventType === "C2C_MESSAGE_CREATE" && message.author?.user_openid) {
      chatId = message.author.user_openid;
    }
    
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
      eventType,
      attachmentCount: Array.isArray(message.attachments) ? message.attachments.length : 0,
    });

    const rawText = message.content || "";
    // 如果是频道被@或者是群里被@的消息，最好能过滤掉类似 `<@!1234>` 的本身
    const userText = sanitizeUserText(rawText).replace(/<@!\d+>/g, "").trim();

    let media: DownloadedQQMedia;
    try {
      media = await this.downloadMessageMedia(message);
    } catch (error) {
      logger.error("qqbot.media.download_failed", {
        messageId: message.id,
        chatId,
        error,
      });
      await this.sendText(chatId, message.id, "附件已收到，但下载失败，请重试。", eventType);
      return;
    }

    const effectiveUserText = buildIncomingUserText(userText, media);
    logger.info("qqbot.message.media_resolved", {
      messageId: message.id,
      chatId,
      textChars: userText.length,
      imageCount: media.imagePaths.length,
      fileCount: media.filePaths.length,
    });

    if (!effectiveUserText) {
      if (media.tempDir) {
        await rm(media.tempDir, { recursive: true, force: true }).catch(() => {});
      }
      return;
    }

    this.enqueueChatTask(chatId, async () => {
      try {
        if (media.imagePaths.length === 0 && media.filePaths.length === 0) {
          const cmd = handleCommand(userText, chatId, "qqbot", this.callbacks!);
          if (cmd.handled) {
            if (cmd.reply) await this.sendText(chatId, message.id, cmd.reply, eventType);
            return;
          }
        }

        try {
          const reply = await this.callbacks!.generateReply(
            chatId,
            effectiveUserText,
            media.imagePaths.length > 0 ? media.imagePaths : undefined,
            "qqbot"
          );
          await this.sendReply(chatId, message.id, reply, eventType);
        } catch (error) {
          logger.error("qqbot.text.failed", {
            messageId: message.id,
            chatId: chatId,
            error,
          });
          await this.sendText(chatId, message.id, "处理消息时出错了，请稍后再试。", eventType);
        }
      } catch (error) {
        logger.error("qqbot.reply.failed", { messageId: message.id, chatId, error });
      } finally {
        if (media.tempDir) {
          await rm(media.tempDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    });
  }

  private async sendReply(chatId: string, msgId: string | undefined, reply: string, eventType: string): Promise<void> {
    const payload = parseReplyPayload(reply, getWorkdir());
    logger.info("qqbot.send_reply", {
      chatId,
      eventType,
      textChars: payload.text.length,
      imageCount: payload.imagePaths.length,
      fileCount: payload.filePaths.length,
    });

    let msgSeq = 1;
    if (payload.text) {
      await this.sendText(chatId, msgId, payload.text, eventType, msgSeq++);
    } else if (payload.imagePaths.length > 0) {
      await this.sendText(chatId, msgId, "请查看图片。", eventType, msgSeq++);
    }

    for (const imagePath of payload.imagePaths) {
      await this.sendImage(chatId, msgId, imagePath, eventType, msgSeq++);
    }

    if (payload.filePaths.length > 0) {
      const fileText = [
        "QQ 渠道当前未放开非图片文件发送，文件已生成在本机：",
        ...payload.filePaths.map((filePath) => `- ${filePath}`),
      ].join("\n");
      await this.sendText(chatId, msgId, fileText, eventType, msgSeq++);
    }

    if (!payload.text && payload.imagePaths.length === 0 && payload.filePaths.length === 0) {
      await this.sendText(chatId, msgId, reply, eventType, msgSeq++);
    }
  }

  private async downloadMessageMedia(message: any): Promise<DownloadedQQMedia> {
    const result: DownloadedQQMedia = { imagePaths: [], filePaths: [], tempDir: null };
    const attachments = Array.isArray(message.attachments)
      ? message.attachments as QQAttachment[]
      : [];
    if (attachments.length === 0) {
      return result;
    }

    let mediaIndex = 0;
    const ensureTempDir = async () => {
      result.tempDir ??= await mkdtemp(path.join(tmpdir(), "anybot-qq-media-"));
      return result.tempDir;
    };

    for (const attachment of attachments) {
      const url = normalizeAttachmentUrl(attachment.url);
      if (!url) continue;

      const declaredSize = Number(attachment.size || 0);
      if (declaredSize > QQ_MAX_INCOMING_ATTACHMENT_BYTES) {
        throw new Error(`QQ attachment exceeds 50MB: ${attachment.filename || attachment.id || url}`);
      }

      const tempDir = await ensureTempDir();
      const downloaded = await downloadQQAttachment(attachment, url, tempDir, mediaIndex++);
      if (downloaded.isImage) {
        result.imagePaths.push(downloaded.filePath);
      } else {
        result.filePaths.push({ name: downloaded.fileName, path: downloaded.filePath });
      }
    }

    return result;
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

  private async sendText(
    chatId: string,
    msgId: string | undefined,
    text: string,
    eventType: string,
    msgSeq = 1,
  ): Promise<void> {
    try {
      const url = this.getMessageUrl(chatId, eventType);

      logger.info("qqbot.send_text.start", { chatId, url });
      await this.sendMessageWithMarkdownFallback(url, text, eventType, msgId, msgSeq);
      logger.info("qqbot.send_text.success", { chatId });
    } catch (e) {
      logger.error("qqbot.send_text.failed", { error: e });
    }
  }

  private async sendImage(
    chatId: string,
    msgId: string | undefined,
    imagePath: string,
    eventType: string,
    msgSeq: number,
  ): Promise<void> {
    if (!usesV2MessageBody(eventType)) {
      await this.sendText(
        chatId,
        msgId,
        `QQ 当前仅在群聊/C2C 中支持本地图片回传，图片路径：${imagePath}`,
        eventType,
        msgSeq,
      );
      return;
    }

    const upload = await this.uploadImage(chatId, imagePath, eventType);
    const url = this.getMessageUrl(chatId, eventType);
    await this.postMessage(url, buildQQMediaBody(upload.file_info!, eventType, msgId, msgSeq));
    logger.info("qqbot.send_image.success", { chatId, eventType, imagePath });
  }

  private async uploadImage(chatId: string, imagePath: string, eventType: string): Promise<QQMediaUploadResponse> {
    const fileStat = await stat(imagePath);
    if (!fileStat.isFile()) {
      throw new Error(`不是可发送的图片：${imagePath}`);
    }
    if (fileStat.size <= 0) {
      throw new Error(`图片为空，无法发送：${imagePath}`);
    }
    if (fileStat.size > QQ_MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`QQ 图片超过 10MB，无法发送：${path.basename(imagePath)}`);
    }

    const token = await this.getValidToken();
    const endpoint = eventType === "GROUP_AT_MESSAGE_CREATE"
      ? `${QQ_BASE_API}/v2/groups/${chatId}/files`
      : `${QQ_BASE_API}/v2/users/${chatId}/files`;
    const fileBuffer = await readFile(imagePath);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `QQBot ${token}`,
        "Content-Type": "application/json",
        ...(this.config?.appId ? { "X-Union-Appid": this.config.appId } : {}),
      },
      body: JSON.stringify({
        file_type: QQ_IMAGE_FILE_TYPE,
        file_data: fileBuffer.toString("base64"),
        srv_send_msg: false,
      }),
    });

    const responseData = await readJsonResponse(res) as QQMediaUploadResponse;
    if (!res.ok || !responseData.file_info) {
      logger.error("qqbot.upload_image.failed_http", { status: res.status, response: responseData });
      throw new Error(`QQ upload image failed: HTTP ${res.status}`);
    }
    logger.info("qqbot.upload_image.success", {
      chatId,
      eventType,
      imagePath,
      fileSize: fileStat.size,
    });
    return responseData;
  }

  private getMessageUrl(chatId: string, eventType: string): string {
    if (eventType === "GROUP_AT_MESSAGE_CREATE") {
      return `${QQ_BASE_API}/v2/groups/${chatId}/messages`;
    }
    if (eventType === "C2C_MESSAGE_CREATE") {
      return `${QQ_BASE_API}/v2/users/${chatId}/messages`;
    }
    if (eventType === "DIRECT_MESSAGE_CREATE") {
      return `${QQ_BASE_API}/dms/${chatId}/messages`;
    }
    return `${QQ_BASE_API}/channels/${chatId}/messages`;
  }

  private async sendMessageWithMarkdownFallback(
    url: string,
    text: string,
    eventType: string,
    msgId?: string,
    msgSeq = 1,
  ): Promise<void> {
    try {
      await this.postMessage(url, buildQQMarkdownBody(text, eventType, msgId, msgSeq));
      logger.info("qqbot.send_markdown.success", { url, eventType });
    } catch (error) {
      logger.warn("qqbot.send_markdown.failed_fallback_text", { url, eventType, error });
      await this.postMessage(url, buildQQTextBody(text, eventType, msgId, msgSeq));
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

function buildQQMarkdownBody(
  text: string,
  eventType: string,
  msgId?: string,
  msgSeq = 1,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    markdown: { content: text },
  };
  if (msgId) {
    body.msg_id = msgId;
    body.msg_seq = msgSeq;
  }
  if (usesV2MessageBody(eventType)) {
    body.msg_type = QQ_MARKDOWN_MSG_TYPE;
  }
  return body;
}

function buildQQTextBody(
  text: string,
  eventType: string,
  msgId?: string,
  msgSeq = 1,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content: text,
  };
  if (msgId) {
    body.msg_id = msgId;
    body.msg_seq = msgSeq;
  }
  if (usesV2MessageBody(eventType)) {
    body.msg_type = QQ_TEXT_MSG_TYPE;
  }
  return body;
}

function buildQQMediaBody(
  fileInfo: string,
  eventType: string,
  msgId?: string,
  msgSeq = 1,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    media: { file_info: fileInfo },
  };
  if (msgId) {
    body.msg_id = msgId;
    body.msg_seq = msgSeq;
  }
  if (usesV2MessageBody(eventType)) {
    body.msg_type = QQ_MEDIA_MSG_TYPE;
  }
  return body;
}

function usesV2MessageBody(eventType: string): boolean {
  return eventType === "GROUP_AT_MESSAGE_CREATE" || eventType === "C2C_MESSAGE_CREATE";
}

function normalizeAttachmentUrl(rawUrl?: string): string | null {
  const value = rawUrl?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function downloadQQAttachment(
  attachment: QQAttachment,
  url: string,
  tempDir: string,
  mediaIndex: number,
): Promise<{ filePath: string; fileName: string; isImage: boolean }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`QQ attachment download failed: HTTP ${res.status}`);
  }

  const contentLength = Number(res.headers.get("content-length") || attachment.size || 0);
  if (contentLength > QQ_MAX_INCOMING_ATTACHMENT_BYTES) {
    throw new Error(`QQ attachment exceeds 50MB: ${attachment.filename || attachment.id || url}`);
  }

  const contentType = res.headers.get("content-type") || attachment.content_type || undefined;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > QQ_MAX_INCOMING_ATTACHMENT_BYTES) {
    throw new Error(`QQ attachment exceeds 50MB: ${attachment.filename || attachment.id || url}`);
  }
  let fileName = safeIncomingFileName(
    attachment.filename ||
    getFileNameFromUrl(url) ||
    `attachment-${mediaIndex}${getQQAttachmentExtension(contentType)}`,
  );
  const isImageByType = (contentType || "").toLowerCase().startsWith("image/");
  const isImage = isImageByType || isSupportedImagePath(fileName);
  if (isImage && !isSupportedImagePath(fileName)) {
    const parsed = path.parse(fileName);
    fileName = `${parsed.name || `image-${mediaIndex}`}${getQQImageExtension(contentType)}`;
  }

  const filePath = path.join(tempDir, `${mediaIndex}-${fileName}`);
  await writeFile(filePath, buffer);
  logger.info("qqbot.attachment.download_success", {
    filePath,
    fileName,
    contentType,
    bytes: buffer.length,
    isImage,
  });
  return { filePath, fileName, isImage };
}

function buildIncomingUserText(rawText: string, media: DownloadedQQMedia): string {
  const parts: string[] = [];
  if (rawText) {
    parts.push(rawText);
  } else if (media.imagePaths.length > 0) {
    parts.push(
      "用户发来了图片。请先根据图片内容直接回答；如果缺少上下文，就先简要描述图片里有什么，并询问对方希望你进一步做什么。",
    );
  }

  if (media.filePaths.length > 0) {
    const fileList = media.filePaths.map((f) => `- ${f.name}: ${f.path}`).join("\n");
    parts.push(`用户附带了以下文件，请按需读取并处理：\n${fileList}`);
  }

  if (media.imagePaths.length > 0) {
    const imageList = media.imagePaths.map((p) => `- ${path.basename(p)}: ${p}`).join("\n");
    parts.push(`用户附带了以下图片：\n${imageList}`);
  }

  return parts.join("\n\n").trim();
}

function safeIncomingFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return base || "file.bin";
}

function getFileNameFromUrl(url: string): string | null {
  try {
    const base = path.basename(new URL(url).pathname);
    return base || null;
  } catch {
    return null;
  }
}

function getQQAttachmentExtension(contentType?: string): string {
  if ((contentType || "").toLowerCase().startsWith("image/")) {
    return getQQImageExtension(contentType);
  }
  return ".bin";
}

function getQQImageExtension(contentType?: string): string {
  const ext = getImageExtension(contentType);
  return ext === ".img" ? ".jpg" : ext;
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
