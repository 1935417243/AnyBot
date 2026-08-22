import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DWClient,
  EventAck,
  TOPIC_ROBOT,
} from "dingtalk-stream";
import type { DWClientDownStream } from "dingtalk-stream";

import type { ChannelCallbacks, DingtalkChannelConfig, IChannel } from "./types.js";
import { readChannelConfig, updateChannelConfig } from "./config.js";
import {
  getImageExtension,
  isSupportedImagePath,
  parseReplyPayload,
  sanitizeUserText,
} from "../message.js";
import { includeContentInLogs, logger, rawLogString } from "../logger.js";
import { handleCommand } from "./commands.js";
import { getWorkdir } from "../shared.js";

const MAX_HANDLED_IDS = 5000;
const DINGTALK_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const DINGTALK_API_BASE = "https://api.dingtalk.com";
const DINGTALK_OAPI_BASE = "https://oapi.dingtalk.com";
const DINGTALK_MAX_TEXT_LENGTH = 3500;
const DINGTALK_MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024;

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
  content?: unknown;
}

interface DingtalkAccessTokenResponse {
  accessToken?: string;
  expireIn?: number;
  code?: string;
  message?: string;
  requestId?: string;
}

interface DingtalkMessageContent {
  downloadCode?: string;
  pictureDownloadCode?: string;
  fileName?: string;
  recognition?: string;
  richText?: DingtalkRichTextNode[];
  [key: string]: unknown;
}

interface DingtalkRichTextNode {
  type?: string;
  text?: string;
  downloadCode?: string;
  pictureDownloadCode?: string;
  fileName?: string;
  [key: string]: unknown;
}

interface DingtalkDownloadUrlResponse {
  downloadUrl?: string;
  code?: string;
  message?: string;
  requestId?: string;
}

interface DingtalkMediaUploadResponse {
  errcode?: number;
  errmsg?: string;
  media_id?: string;
  type?: string;
  created_at?: number;
  code?: string;
  message?: string;
}

interface DingtalkSendResponse {
  processQueryKey?: string;
  invalidStaffIdList?: string[];
  flowControlledStaffIdList?: string[];
  code?: string;
  message?: string;
  requestId?: string;
}

interface DownloadedDingtalkMedia {
  imagePaths: string[];
  filePaths: Array<{ name: string; path: string }>;
  tempDir: string | null;
}

interface DingtalkSendTarget {
  msgId?: string;
  sessionWebhook?: string;
  conversationType?: string;
  conversationId?: string;
  userId?: string;
  robotCode?: string;
  atUserId?: string;
  /** 群聊回复时拼在正文前的引用行（> @发送者 [项目名] 消息摘要），@ 后跟 senderStaffId 以形成真实 @ 提及 */
  quoteLine?: string;
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
    if (!this.ownerSessionWebhook && !this.config.robotCode) {
      throw new Error("DingTalk 暂无可用 owner 会话或 robotCode，请先私聊机器人一次后再发送");
    }

    await this.sendReplyToTarget({
      sessionWebhook: this.ownerSessionWebhook || undefined,
      conversationType: "1",
      userId: this.config.ownerChatId,
      robotCode: this.config.robotCode,
    }, text);
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

    const robotCode = message.robotCode?.trim();
    if (robotCode && this.config.robotCode !== robotCode) {
      this.config.robotCode = robotCode;
      updateChannelConfig("dingtalk", { robotCode });
      logger.info("dingtalk.robot_code_auto_saved", { robotCode });
    }

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

    const userText = this.extractUserText(message);
    let media: DownloadedDingtalkMedia;
    try {
      media = await this.downloadMessageMedia(message);
    } catch (error) {
      logger.error("dingtalk.media.download_failed", {
        messageId,
        chatId,
        error,
      });
      await this.sendReply(message, "媒体已收到，但下载失败，请重试。");
      return;
    }

    const effectiveUserText = buildIncomingUserText(userText, media);
    logger.info("dingtalk.message.media_resolved", {
      messageId,
      chatId,
      textChars: userText.length,
      imageCount: media.imagePaths.length,
      fileCount: media.filePaths.length,
    });

    if (!effectiveUserText) {
      await this.sendReply(message, "当前钉钉频道支持文本、图片和文件消息。");
      return;
    }

    this.enqueueChatTask(chatId, async () => {
      try {
        if (!this.callbacks) return;

        if (media.imagePaths.length === 0 && media.filePaths.length === 0) {
          const cmd = handleCommand(userText, chatId, "dingtalk", this.callbacks);
          if (cmd.handled) {
            if (cmd.reply) await this.sendReply(message, cmd.reply);
            return;
          }
        }

        try {
          const reply = await this.callbacks.generateReply(
            chatId,
            effectiveUserText,
            media.imagePaths.length > 0 ? media.imagePaths : undefined,
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
      } catch (error) {
        logger.error("dingtalk.reply.failed", { messageId, chatId, error });
      } finally {
        if (media.tempDir) {
          await rm(media.tempDir, { recursive: true, force: true }).catch(() => {});
        }
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
    await this.sendReplyToTarget({
      msgId: message.msgId,
      sessionWebhook: message.sessionWebhook,
      conversationType: message.conversationType,
      conversationId: message.conversationId,
      userId: message.senderStaffId,
      robotCode: message.robotCode || this.config?.robotCode,
      atUserId: message.conversationType === "2" ? message.senderStaffId : undefined,
      quoteLine: message.conversationType === "2" ? this.buildQuoteLine(message) : undefined,
    }, text);
  }

  /**
   * 构造群聊回复的引用行：> @发送者 [项目名] 原消息摘要（最多 100 字符）
   * 钉钉机器人不支持真正的引用回复，用 markdown 引用格式模拟
   * 注意：@ 后必须跟 senderStaffId 并与 at.atUserIds 一致，钉钉才会渲染为真正的 @ 提及（写昵称只是普通文本）
   */
  private buildQuoteLine(message: DingtalkRobotMessage): string | undefined {
    const atUserId = message.senderStaffId?.trim();
    if (!atUserId) return undefined;

    let summary = this.extractUserText(message).replace(/\s+/g, " ").trim();
    if (!summary) {
      const content = parseDingtalkContent(message.content);
      if (message.msgtype === "file") {
        summary = `[文件] ${content.fileName || ""}`.trim();
      } else if (message.msgtype === "picture" || message.msgtype === "richText") {
        summary = "[图片]";
      } else if (message.msgtype === "audio") {
        summary = "[语音]";
      }
    }
    if (summary.length > 100) {
      summary = `${summary.slice(0, 100)}…`;
    }

    const chatId = message.conversationId?.trim();
    const workspaceName = chatId && this.callbacks
      ? this.callbacks.listWorkspaces(chatId, "dingtalk").find((w) => w.isCurrent)?.name
      : undefined;

    return `> @${atUserId}${workspaceName ? ` [${workspaceName}]` : ""}${summary ? ` ${summary}` : ""}`;
  }

  private async sendReplyToTarget(target: DingtalkSendTarget, reply: string): Promise<void> {
    const payload = parseReplyPayload(reply, getWorkdir());
    logger.info("dingtalk.send_reply", {
      msgId: target.msgId,
      conversationType: target.conversationType,
      textChars: payload.text.length,
      imageCount: payload.imagePaths.length,
      fileCount: payload.filePaths.length,
      ...(includeContentInLogs()
        ? {
            reply: rawLogString(reply),
            text: rawLogString(payload.text),
          }
        : {}),
    });

    if (payload.text) {
      await this.sendMarkdownToTarget(target, payload.text);
    } else if (payload.imagePaths.length > 0 || payload.filePaths.length > 0) {
      await this.sendMarkdownToTarget(target, "请查看附件。");
    }

    for (const imagePath of payload.imagePaths) {
      await this.sendImageToTarget(target, imagePath);
    }

    for (const filePath of payload.filePaths) {
      await this.sendFileToTarget(target, filePath);
    }

    if (!payload.text && payload.imagePaths.length === 0 && payload.filePaths.length === 0) {
      await this.sendMarkdownToTarget(target, reply);
    }
  }

  private async sendMarkdownToTarget(target: DingtalkSendTarget, text: string): Promise<void> {
    if (target.sessionWebhook) {
      for (const chunk of this.splitMessage(text)) {
        await this.sendWebhookMarkdown(target.sessionWebhook, chunk, target.atUserId, target.quoteLine);
      }
      return;
    }

    for (const chunk of this.splitMessage(text)) {
      await this.sendRobotTemplateMessage(target, "sampleMarkdown", {
        title: "AnyBot 回复",
        text: chunk,
      });
    }
  }

  private async sendImageToTarget(target: DingtalkSendTarget, imagePath: string): Promise<void> {
    const mediaId = await this.uploadMedia(imagePath, "image");
    await this.sendRobotTemplateMessage(target, "sampleImageMsg", {
      photoURL: mediaId,
    });
    logger.info("dingtalk.send_image.success", {
      msgId: target.msgId,
      imagePath,
      mediaId,
    });
  }

  private async sendFileToTarget(target: DingtalkSendTarget, filePath: string): Promise<void> {
    const mediaId = await this.uploadMedia(filePath, "file");
    const fileName = path.basename(filePath);
    await this.sendRobotTemplateMessage(target, "sampleFile", {
      mediaId,
      fileName,
      fileType: getDingtalkFileType(filePath),
    });
    logger.info("dingtalk.send_file.success", {
      msgId: target.msgId,
      filePath,
      mediaId,
    });
  }

  private async sendRobotTemplateMessage(
    target: DingtalkSendTarget,
    msgKey: string,
    msgParam: Record<string, unknown>,
  ): Promise<void> {
    const robotCode = target.robotCode?.trim() || this.config?.robotCode?.trim();
    if (!robotCode) {
      throw new Error("DingTalk robotCode 未缓存，请先让钉钉机器人收到一条消息");
    }

    const body: Record<string, unknown> = {
      robotCode,
      msgKey,
      msgParam: JSON.stringify(msgParam),
    };
    const isGroup = target.conversationType === "2";
    const endpoint = isGroup
      ? `${DINGTALK_API_BASE}/v1.0/robot/groupMessages/send`
      : `${DINGTALK_API_BASE}/v1.0/robot/oToMessages/batchSend`;

    if (isGroup) {
      const openConversationId = target.conversationId?.trim();
      if (!openConversationId) {
        throw new Error("DingTalk openConversationId 缺失，无法发送群附件");
      }
      body.openConversationId = openConversationId;
    } else {
      const userId = target.userId?.trim();
      if (!userId) {
        throw new Error("DingTalk userId 缺失，无法发送单聊附件");
      }
      body.userIds = [userId];
    }

    const data = await this.apiPost<DingtalkSendResponse>(endpoint, body);
    logger.debug("dingtalk.robot_message.sent", {
      msgKey,
      conversationType: target.conversationType,
      processQueryKey: data.processQueryKey,
      invalidStaffIdList: data.invalidStaffIdList,
      flowControlledStaffIdList: data.flowControlledStaffIdList,
    });
  }

  private extractUserText(message: DingtalkRobotMessage): string {
    if (message.msgtype === "text") {
      return sanitizeUserText(message.text?.content || "");
    }

    const content = parseDingtalkContent(message.content);
    if (message.msgtype === "richText" && content.richText?.length) {
      return sanitizeUserText(
        content.richText
          .map((item) => typeof item.text === "string" ? item.text : "")
          .filter(Boolean)
          .join("\n"),
      );
    }

    if (message.msgtype === "audio" && typeof content.recognition === "string") {
      return sanitizeUserText(content.recognition);
    }

    return "";
  }

  private async downloadMessageMedia(message: DingtalkRobotMessage): Promise<DownloadedDingtalkMedia> {
    const result: DownloadedDingtalkMedia = { imagePaths: [], filePaths: [], tempDir: null };
    const robotCode = message.robotCode?.trim() || this.config?.robotCode?.trim();
    if (!robotCode) {
      return result;
    }

    let mediaIndex = 0;
    const ensureTempDir = async () => {
      result.tempDir ??= await mkdtemp(path.join(tmpdir(), "anybot-dingtalk-media-"));
      return result.tempDir;
    };

    const download = async (
      downloadCode: string | undefined,
      fileName: string | undefined,
      forceImage: boolean,
    ) => {
      if (!downloadCode?.trim()) return;
      const tempDir = await ensureTempDir();
      const downloaded = await this.downloadMediaByCode({
        downloadCode,
        robotCode,
        tempDir,
        mediaIndex: mediaIndex++,
        fileName,
        forceImage,
      });
      if (downloaded.isImage) {
        result.imagePaths.push(downloaded.filePath);
      } else {
        result.filePaths.push({ name: downloaded.fileName, path: downloaded.filePath });
      }
    };

    const content = parseDingtalkContent(message.content);
    if (message.msgtype === "picture") {
      await download(content.downloadCode || content.pictureDownloadCode, content.fileName, true);
    } else if (message.msgtype === "file") {
      await download(content.downloadCode, content.fileName, false);
    } else if (message.msgtype === "richText" && content.richText?.length) {
      for (const item of content.richText) {
        const isPicture = item.type === "picture" || Boolean(item.pictureDownloadCode);
        await download(item.downloadCode || item.pictureDownloadCode, item.fileName, isPicture);
      }
    }

    return result;
  }

  private async downloadMediaByCode(params: {
    downloadCode: string;
    robotCode: string;
    tempDir: string;
    mediaIndex: number;
    fileName?: string;
    forceImage: boolean;
  }): Promise<{ filePath: string; fileName: string; isImage: boolean }> {
    const downloadUrl = await this.getMediaDownloadUrl(params.downloadCode, params.robotCode);
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`DingTalk media download failed: HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || undefined;
    const buffer = Buffer.from(await res.arrayBuffer());
    let fileName =
      params.fileName ||
      getFileNameFromContentDisposition(res.headers.get("content-disposition")) ||
      (params.forceImage ? `image-${params.mediaIndex}${getDingtalkImageExtension(contentType)}` : `file-${params.mediaIndex}.bin`);
    fileName = safeIncomingFileName(fileName);

    const isImageByType = (contentType || "").toLowerCase().startsWith("image/");
    const isImage = params.forceImage || isImageByType || isSupportedImagePath(fileName);
    if (isImage && !isSupportedImagePath(fileName)) {
      const parsed = path.parse(fileName);
      fileName = `${parsed.name || `image-${params.mediaIndex}`}${getDingtalkImageExtension(contentType)}`;
    }

    const filePath = path.join(params.tempDir, `${params.mediaIndex}-${fileName}`);
    await writeFile(filePath, buffer);
    logger.info("dingtalk.media.download_success", {
      filePath,
      fileName,
      contentType,
      bytes: buffer.length,
      isImage,
    });
    return { filePath, fileName, isImage };
  }

  private async getMediaDownloadUrl(downloadCode: string, robotCode: string): Promise<string> {
    const data = await this.apiPost<DingtalkDownloadUrlResponse>(
      `${DINGTALK_API_BASE}/v1.0/robot/messageFiles/download`,
      { downloadCode, robotCode },
    );
    if (!data.downloadUrl) {
      throw new Error(`DingTalk media download URL missing: ${formatDingtalkError(data)}`);
    }
    return data.downloadUrl;
  }

  private async uploadMedia(filePath: string, mediaType: "image" | "file"): Promise<string> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`不是可发送的文件：${filePath}`);
    }
    if (fileStat.size <= 0) {
      throw new Error(`文件为空，无法发送：${filePath}`);
    }
    if (fileStat.size > DINGTALK_MAX_MEDIA_SIZE_BYTES) {
      throw new Error(`钉钉附件超过 20MB，无法发送：${path.basename(filePath)}`);
    }

    const token = await this.getAccessToken();
    const form = new FormData();
    const buffer = await readFile(filePath);
    form.append("media", new Blob([new Uint8Array(buffer)]), path.basename(filePath));

    const res = await fetch(
      `${DINGTALK_OAPI_BASE}/media/upload?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(mediaType)}`,
      {
        method: "POST",
        body: form,
      },
    );
    const data = await readJsonResponse(res) as DingtalkMediaUploadResponse;
    const failed = !res.ok || (data.errcode !== undefined && data.errcode !== 0);
    if (failed || !data.media_id) {
      throw new Error(`DingTalk media upload failed: HTTP ${res.status} ${formatDingtalkError(data)}`);
    }
    logger.info("dingtalk.media.upload_success", {
      filePath,
      mediaType,
      mediaId: data.media_id,
      fileSize: fileStat.size,
    });
    return data.media_id;
  }

  private async apiPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify(body),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) {
      throw new Error(`DingTalk API failed: HTTP ${res.status} ${formatDingtalkError(data)}`);
    }
    return data as T;
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
    quoteLine?: string,
  ): Promise<void> {
    const token = await this.getAccessToken();
    // 钉钉 markdown 消息只有在文本中出现 @昵称 时，atUserIds 才会真正渲染为可点击的 @ 提及
    const markdownText = quoteLine ? `${quoteLine}\n\n${text}` : text;
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
          text: markdownText,
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

function parseDingtalkContent(content: unknown): DingtalkMessageContent {
  if (!content) return {};
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as DingtalkMessageContent;
    } catch {
      return {};
    }
  }
  if (typeof content === "object") {
    return content as DingtalkMessageContent;
  }
  return {};
}

function buildIncomingUserText(rawText: string, media: DownloadedDingtalkMedia): string {
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

function getFileNameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;

  const encodedMatch = value.match(/filename\*=UTF-8''([^;\n]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const plainMatch = value.match(/filename="?([^";\n]+)"?/i);
  return plainMatch?.[1] || null;
}

function getDingtalkFileType(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase() || "file";
}

function getDingtalkImageExtension(contentType?: string): string {
  const ext = getImageExtension(contentType);
  return ext === ".img" ? ".jpg" : ext;
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
