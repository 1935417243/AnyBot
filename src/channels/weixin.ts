import crypto from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleCommand } from "./commands.js";
import { readChannelConfig, updateChannelConfig } from "./config.js";
import type { ChannelCallbacks, IChannel, WeixinChannelConfig } from "./types.js";
import { logger } from "../logger.js";
import { parseReplyPayload, isSupportedImagePath } from "../message.js";
import { getWorkdir } from "../shared.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const FIXED_LOGIN_BASE_URL = "https://ilinkai.weixin.qq.com";
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const DEFAULT_BOT_TYPE = "3";
const packageJson = require("../../package.json") as { version?: unknown };
const appVersion = typeof packageJson.version === "string" && packageJson.version.trim()
  ? packageJson.version.trim()
  : "0.0.0";
const DEFAULT_BOT_AGENT = `AnyBot/${appVersion}`;
const CHANNEL_VERSION = "2.4.3";
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION);
const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const CDN_UPLOAD_TIMEOUT_MS = 60_000;
const CDN_DOWNLOAD_TIMEOUT_MS = 60_000;
const WEIXIN_RETRY_ATTEMPTS = 3;
const LOGIN_TIMEOUT_MS = 8 * 60_000;
const SESSION_EXPIRED_ERRCODE = -14;
const MAX_WEIXIN_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;
const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.resolve(__dirname, "../../.data");
const SYNC_PATH = path.join(dataDir, "weixin-sync.json");

const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
} as const;

const UploadMediaType = {
  IMAGE: 1,
  FILE: 3,
} as const;

const MessageType = {
  USER: 1,
  BOT: 2,
} as const;

const MessageState = {
  FINISH: 2,
} as const;

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

type QRStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

interface StatusResponse {
  status: QRStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

interface ImageItem {
  media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
}

interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  image_item?: ImageItem;
  file_item?: FileItem;
}

interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

interface GetUploadUrlResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  upload_param?: string;
  upload_full_url?: string;
}

interface UploadedMedia {
  downloadEncryptedQueryParam: string;
  aeskeyHex: string;
  fileSize: number;
  fileSizeCiphertext: number;
  md5: string;
}

interface DownloadedMedia {
  imagePaths: string[];
  filePaths: Array<{ name: string; path: string }>;
  tempDir: string | null;
}

interface LoginResult {
  accountId: string;
  token: string;
  baseUrl: string;
  ownerChatId?: string;
}

export interface WeixinLoginStatus {
  state: "idle" | "pending" | "scanned" | "waiting_code" | "confirmed" | "failed";
  message: string;
  qrcodeUrl?: string;
  qrcodeDataUrl?: string;
  startedAt?: number;
  updatedAt?: number;
}

let loginStatus: WeixinLoginStatus = {
  state: "idle",
  message: "微信频道未开始登录",
};

export function getWeixinLoginStatus(): WeixinLoginStatus {
  return loginStatus;
}

export class WeixinChannel implements IChannel {
  readonly type = "weixin";

  private config: WeixinChannelConfig | null = null;
  private callbacks: ChannelCallbacks | null = null;
  private stopped = true;
  private pollAbort: AbortController | null = null;
  private contextTokens = new Map<string, string>();
  private getUpdatesBuf = "";

  async start(callbacks: ChannelCallbacks): Promise<boolean> {
    const config = readChannelConfig<WeixinChannelConfig>("weixin");
    if (!config?.enabled) {
      logger.info("weixin.skipped", { reason: "disabled or missing config" });
      return false;
    }

    this.callbacks = callbacks;
    this.config = normalizeConfig(config);
    this.stopped = false;
    this.getUpdatesBuf = loadSyncBuf();

    if (!this.config.token?.trim() || !this.config.accountId?.trim()) {
      logger.warn("weixin.login_required", {
        message: "微信频道未绑定，正在输出二维码，请用个人微信扫码确认",
      });
      void this.loginInBackground();
      return true;
    }

    await this.notifyStart();
    void this.pollLoop();
    logger.info("weixin.started", {
      accountId: this.config.accountId,
      ownerChatId: this.config.ownerChatId,
    });
    return true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pollAbort?.abort();
    this.pollAbort = null;
    await this.notifyStop();
    logger.info("weixin.stopped");
  }

  async startLogin(callbacks: ChannelCallbacks): Promise<boolean> {
    const config = readChannelConfig<WeixinChannelConfig>("weixin");
    this.callbacks = callbacks;
    this.config = normalizeConfig(config ?? {});
    this.stopped = false;
    this.getUpdatesBuf = loadSyncBuf();

    if (this.config.token?.trim() && this.config.accountId?.trim()) {
      logger.info("weixin.login_skipped", { reason: "already bound" });
      return false;
    }

    logger.warn("weixin.login_required", {
      message: "微信频道未绑定，正在输出二维码，请用个人微信扫码确认",
    });
    void this.loginInBackground();
    return true;
  }

  async sendToOwner(text: string): Promise<void> {
    if (!this.config?.token) {
      throw new Error("Weixin channel is not started");
    }
    const ownerChatId = this.config.ownerChatId?.trim();
    if (!ownerChatId) {
      throw new Error("微信 ownerChatId 未设置，请先给 AnyBot 发一条微信消息");
    }
    await this.sendReply(ownerChatId, text, this.contextTokens.get(ownerChatId));
  }

  private async loginInBackground(): Promise<void> {
    try {
      const login = await this.loginWithQr();
      if (this.stopped || !this.config) return;
      this.config = {
        ...this.config,
        accountId: login.accountId,
        token: login.token,
        baseUrl: login.baseUrl || this.config.baseUrl || DEFAULT_BASE_URL,
        ownerChatId: this.config.ownerChatId || login.ownerChatId || "",
      };
      updateChannelConfig("weixin", {
        enabled: true,
        accountId: this.config.accountId,
        token: this.config.token,
        baseUrl: this.config.baseUrl,
        ownerChatId: this.config.ownerChatId,
      });
      logger.info("weixin.login_saved", {
        accountId: this.config.accountId,
        ownerChatId: this.config.ownerChatId,
      });
      await this.notifyStart();
      if (this.stopped) return;
      void this.pollLoop();
      logger.info("weixin.started", {
        accountId: this.config.accountId,
        ownerChatId: this.config.ownerChatId,
      });
    } catch (error) {
      if (!this.stopped) {
        logger.error("weixin.login_failed", { error });
      }
    }
  }

  private async loginWithQr(): Promise<LoginResult> {
    const botType = this.config?.botType || DEFAULT_BOT_TYPE;
    let qr: QRCodeResponse;
    let qrcodeDataUrl: string | undefined;
    try {
      qr = await this.fetchQRCode(botType);
      qrcodeDataUrl = await generateQRCodeDataUrl(qr.qrcode_img_content);
    } catch (error) {
      const message = `微信二维码生成失败：${error instanceof Error ? error.message : String(error)}`;
      setWeixinLoginStatus({ state: "failed", message });
      throw error;
    }
    setWeixinLoginStatus({
      state: "pending",
      message: "请用个人微信扫码绑定 AnyBot",
      qrcodeUrl: qr.qrcode_img_content,
      qrcodeDataUrl,
      startedAt: Date.now(),
    });
    logger.info("weixin.login.qr_url", { url: qr.qrcode_img_content });
    console.log("\n[AnyBot 微信] 请用个人微信扫描以下二维码完成绑定：\n");
    displayQRCode(qr.qrcode_img_content);
    console.log("\n如果终端二维码不可用，请打开这个链接：");
    console.log(qr.qrcode_img_content);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let currentBaseUrl = FIXED_LOGIN_BASE_URL;
    let verifyCode: string | undefined;
    let scannedPrinted = false;

    while (Date.now() < deadline && !this.stopped) {
      const status = await this.pollQRStatus(currentBaseUrl, qr.qrcode, verifyCode);
      switch (status.status) {
        case "wait":
          break;
        case "scaned":
          verifyCode = undefined;
          if (!scannedPrinted) {
            setWeixinLoginStatus({
              state: "scanned",
              message: "已扫码，请在手机微信上确认",
            });
            console.log("[AnyBot 微信] 已扫码，等待手机确认...");
            scannedPrinted = true;
          }
          break;
        case "need_verifycode":
          setWeixinLoginStatus({
            state: "waiting_code",
            message: "手机微信要求输入数字验证码，请在终端输入",
          });
          try {
            verifyCode = await readVerifyCodeFromStdin(
              verifyCode ? "验证码不匹配，请重新输入手机微信显示的数字：" : "请输入手机微信显示的数字：",
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setWeixinLoginStatus({ state: "failed", message });
            throw error;
          }
          break;
        case "scaned_but_redirect":
          if (status.redirect_host) {
            currentBaseUrl = `https://${status.redirect_host}`;
            logger.info("weixin.login.redirect", { host: status.redirect_host });
          }
          break;
        case "verify_code_blocked":
          setWeixinLoginStatus({ state: "failed", message: "微信扫码验证码多次错误，请稍后重试" });
          throw new Error("微信扫码验证码多次错误，请稍后重试");
        case "expired":
          setWeixinLoginStatus({ state: "failed", message: "微信登录二维码已过期，请重启 AnyBot 后重新扫码" });
          throw new Error("微信登录二维码已过期，请重启 AnyBot 后重新扫码");
        case "binded_redirect":
          setWeixinLoginStatus({
            state: "failed",
            message: "此微信已绑定过，但本地没有可用 token，请重新发起绑定或清理旧绑定后再试",
          });
          throw new Error("此微信已绑定过，但本地没有可用 token，请重新发起绑定或清理旧绑定后再试");
        case "confirmed":
          if (!status.bot_token || !status.ilink_bot_id) {
            setWeixinLoginStatus({
              state: "failed",
              message: "微信登录成功但服务端未返回 bot_token 或 ilink_bot_id",
            });
            throw new Error("微信登录成功但服务端未返回 bot_token 或 ilink_bot_id");
          }
          setWeixinLoginStatus({
            state: "confirmed",
            message: "微信绑定成功",
          });
          console.log("[AnyBot 微信] 绑定成功。");
          return {
            accountId: status.ilink_bot_id,
            token: status.bot_token,
            baseUrl: status.baseurl || currentBaseUrl || DEFAULT_BASE_URL,
            ownerChatId: status.ilink_user_id,
          };
      }
      await sleep(1000);
    }

    setWeixinLoginStatus({ state: "failed", message: "微信登录超时，请重启 AnyBot 后重新扫码" });
    throw new Error("微信登录超时，请重启 AnyBot 后重新扫码");
  }

  private async pollLoop(): Promise<void> {
    let consecutiveFailures = 0;
    let nextTimeoutMs = LONG_POLL_TIMEOUT_MS;

    while (!this.stopped && this.config?.token) {
      this.pollAbort = new AbortController();
      try {
        const resp = await this.getUpdates(nextTimeoutMs, this.pollAbort.signal);
        if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms;
        }

        const failed =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0);
        if (failed) {
          consecutiveFailures += 1;
          logger.warn("weixin.getupdates.failed", {
            ret: resp.ret,
            errcode: resp.errcode,
            errmsg: resp.errmsg,
            consecutiveFailures,
          });
          if (resp.ret === SESSION_EXPIRED_ERRCODE || resp.errcode === SESSION_EXPIRED_ERRCODE) {
            logger.error("weixin.session_expired", {
              message: "微信登录态已失效，请清空 token 后重启并重新扫码",
            });
            await sleep(60_000);
          } else {
            await sleep(consecutiveFailures >= 3 ? 30_000 : 2_000);
          }
          continue;
        }

        consecutiveFailures = 0;
        if (resp.get_updates_buf) {
          this.getUpdatesBuf = resp.get_updates_buf;
          saveSyncBuf(this.getUpdatesBuf);
        }

        for (const msg of resp.msgs ?? []) {
          await this.handleMessage(msg);
        }
      } catch (error) {
        if (this.stopped) return;
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        consecutiveFailures += 1;
        logger.error("weixin.poll.error", { error, consecutiveFailures });
        await sleep(consecutiveFailures >= 3 ? 30_000 : 2_000);
      } finally {
        this.pollAbort = null;
      }
    }
  }

  private async handleMessage(message: WeixinMessage): Promise<void> {
    if (!this.callbacks || !this.config) return;
    if (message.message_type === MessageType.BOT) return;

    const chatId = message.from_user_id?.trim();
    if (!chatId) {
      logger.warn("weixin.message.no_chat_id", { messageId: message.message_id });
      return;
    }

    if (message.context_token) {
      this.contextTokens.set(chatId, message.context_token);
    }

    if (!this.config.ownerChatId) {
      this.config.ownerChatId = chatId;
      updateChannelConfig("weixin", { ownerChatId: chatId });
      logger.info("weixin.owner_auto_saved", { chatId });
    }

    const userText = extractText(message).trim();
    let media: DownloadedMedia;
    try {
      media = await this.downloadMessageMedia(message);
    } catch (error) {
      logger.error("weixin.media.download_failed", {
        chatId,
        messageId: message.message_id,
        error,
      });
      await this.sendText(chatId, "媒体已收到，但下载失败，请重试。", message.context_token);
      return;
    }
    const effectiveUserText = buildIncomingUserText(userText, media);
    logger.info("weixin.message.received", {
      chatId,
      messageId: message.message_id,
      textChars: userText.length,
      imageCount: media.imagePaths.length,
      fileCount: media.filePaths.length,
    });

    if (!effectiveUserText) {
      await this.sendText(chatId, "当前微信频道支持文本、图片和文件消息。", message.context_token);
      return;
    }

    if (media.imagePaths.length === 0 && media.filePaths.length === 0) {
      const cmd = handleCommand(userText, chatId, "weixin", this.callbacks);
      if (cmd.handled) {
        if (cmd.reply) await this.sendText(chatId, cmd.reply, message.context_token);
        return;
      }
    }

    try {
      try {
        const reply = await this.callbacks.generateReply(
          chatId,
          effectiveUserText,
          media.imagePaths.length > 0 ? media.imagePaths : undefined,
          "weixin",
        );
        await this.sendReply(chatId, reply, message.context_token);
      } catch (error) {
        logger.error("weixin.text.failed", { chatId, error });
        await this.sendText(chatId, `处理失败：${error instanceof Error ? error.message : String(error)}`, message.context_token);
      }
    } finally {
      if (media.tempDir) {
        await rm(media.tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private async fetchQRCode(botType: string): Promise<QRCodeResponse> {
    const raw = await apiPost({
      baseUrl: FIXED_LOGIN_BASE_URL,
      endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
      body: { local_token_list: [] },
      botAgent: this.config?.botAgent,
      label: "weixin.fetch_qrcode",
      timeoutMs: API_TIMEOUT_MS,
    });
    return JSON.parse(raw) as QRCodeResponse;
  }

  private async pollQRStatus(
    baseUrl: string,
    qrcode: string,
    verifyCode?: string,
  ): Promise<StatusResponse> {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    try {
      const raw = await apiGet({
        baseUrl,
        endpoint,
        label: "weixin.poll_qr",
        timeoutMs: LONG_POLL_TIMEOUT_MS,
      });
      return JSON.parse(raw) as StatusResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { status: "wait" };
      }
      logger.warn("weixin.poll_qr.retry", { error });
      return { status: "wait" };
    }
  }

  private async getUpdates(timeoutMs: number, signal: AbortSignal): Promise<GetUpdatesResp> {
    const raw = await apiPost({
      baseUrl: this.config!.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: {
        get_updates_buf: this.getUpdatesBuf,
        base_info: buildBaseInfo(this.config?.botAgent),
      },
      token: this.config!.token,
      botAgent: this.config?.botAgent,
      label: "weixin.getupdates",
      timeoutMs,
      signal,
    });
    return JSON.parse(raw) as GetUpdatesResp;
  }

  private async sendText(to: string, text: string, contextToken?: string): Promise<void> {
    if (!this.config?.token) {
      throw new Error("Weixin channel is not started");
    }
    const clientId = `anybot-weixin:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    await apiPost({
      baseUrl: this.config.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      body: {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: clientId,
          message_type: MessageType.BOT,
          message_state: MessageState.FINISH,
          item_list: text
            ? [{ type: MessageItemType.TEXT, text_item: { text } }]
            : undefined,
          context_token: contextToken || this.contextTokens.get(to) || undefined,
        },
        base_info: buildBaseInfo(this.config.botAgent),
      },
      token: this.config.token,
      botAgent: this.config.botAgent,
      label: "weixin.sendmessage",
      timeoutMs: API_TIMEOUT_MS,
    });
    logger.info("weixin.send_text.success", { to, clientId });
  }

  private async sendReply(to: string, reply: string, contextToken?: string): Promise<void> {
    const payload = parseReplyPayload(reply, getWorkdir());
    logger.info("weixin.send_reply", {
      to,
      textChars: payload.text.length,
      imageCount: payload.imagePaths.length,
      fileCount: payload.filePaths.length,
    });

    if (payload.text) {
      await this.sendText(to, payload.text, contextToken);
    } else if (payload.imagePaths.length > 0 || payload.filePaths.length > 0) {
      await this.sendText(to, "请查看附件。", contextToken);
    }

    for (const imagePath of payload.imagePaths) {
      await this.sendImage(to, imagePath, contextToken);
    }

    for (const filePath of payload.filePaths) {
      await this.sendFile(to, filePath, contextToken);
    }

    if (!payload.text && payload.imagePaths.length === 0 && payload.filePaths.length === 0) {
      await this.sendText(to, reply, contextToken);
    }
  }

  private async sendImage(to: string, imagePath: string, contextToken?: string): Promise<void> {
    const uploaded = await this.uploadMedia(imagePath, to, UploadMediaType.IMAGE);
    await this.sendMessageItems(
      to,
      [
        {
          type: MessageItemType.IMAGE,
          image_item: {
            media: buildCdnMediaRef(uploaded),
            mid_size: uploaded.fileSizeCiphertext,
          },
        },
      ],
      contextToken,
    );
    logger.info("weixin.send_image.success", { to, imagePath });
  }

  private async sendFile(to: string, filePath: string, contextToken?: string): Promise<void> {
    const uploaded = await this.uploadMedia(filePath, to, UploadMediaType.FILE);
    await this.sendMessageItems(
      to,
      [
        {
          type: MessageItemType.FILE,
          file_item: {
            media: buildCdnMediaRef(uploaded),
            file_name: path.basename(filePath),
            md5: uploaded.md5,
            len: String(uploaded.fileSize),
          },
        },
      ],
      contextToken,
    );
    logger.info("weixin.send_file.success", { to, filePath, fileSize: uploaded.fileSize });
  }

  private async sendMessageItems(
    to: string,
    items: MessageItem[],
    contextToken?: string,
  ): Promise<void> {
    if (!this.config?.token) {
      throw new Error("Weixin channel is not started");
    }
    const clientId = `anybot-weixin:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    await retryWeixinOperation("weixin.sendmessage", async () => {
      const raw = await apiPost({
        baseUrl: this.config!.baseUrl,
        endpoint: "ilink/bot/sendmessage",
        body: {
          msg: {
            from_user_id: "",
            to_user_id: to,
            client_id: clientId,
            message_type: MessageType.BOT,
            message_state: MessageState.FINISH,
            item_list: items.length > 0 ? items : undefined,
            context_token: contextToken || this.contextTokens.get(to) || undefined,
          },
          base_info: buildBaseInfo(this.config!.botAgent),
        },
        token: this.config!.token,
        botAgent: this.config!.botAgent,
        label: "weixin.sendmessage",
        timeoutMs: API_TIMEOUT_MS,
      });
      assertIlinkOk(raw, "weixin.sendmessage");
    });
    logger.info("weixin.send_items.success", { to, clientId, itemCount: items.length });
  }

  private async uploadMedia(
    filePath: string,
    to: string,
    mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType],
  ): Promise<UploadedMedia> {
    if (!this.config?.token) {
      throw new Error("Weixin channel is not started");
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`Not a sendable file: ${filePath}`);
    }
    if (fileStat.size <= 0) {
      throw new Error(`Cannot send empty file: ${filePath}`);
    }
    if (fileStat.size > MAX_WEIXIN_MEDIA_SIZE_BYTES) {
      throw new Error(`Weixin media exceeds 50MB: ${path.basename(filePath)}`);
    }

    const plaintext = await readFile(filePath);
    const rawsize = plaintext.length;
    const md5 = crypto.createHash("md5").update(plaintext).digest("hex");
    const filesize = aesEcbPaddedSize(rawsize);
    const filekey = crypto.randomBytes(16).toString("hex");
    const aeskey = crypto.randomBytes(16);
    const aeskeyHex = aeskey.toString("hex");
    const uploadUrl = await this.getUploadUrl({
      filekey,
      media_type: mediaType,
      to_user_id: to,
      rawsize,
      rawfilemd5: md5,
      filesize,
      no_need_thumb: true,
      aeskey: aeskeyHex,
    });
    const downloadEncryptedQueryParam = await uploadBufferToCdn({
      plaintext,
      uploadParam: uploadUrl.upload_param,
      uploadFullUrl: uploadUrl.upload_full_url,
      filekey,
      aeskey,
    });

    return {
      downloadEncryptedQueryParam,
      aeskeyHex,
      fileSize: rawsize,
      fileSizeCiphertext: filesize,
      md5,
    };
  }

  private async getUploadUrl(body: Record<string, unknown>): Promise<GetUploadUrlResp> {
    if (!this.config?.token) {
      throw new Error("Weixin channel is not started");
    }
    const raw = await retryWeixinOperation("weixin.getuploadurl", async () => {
      const response = await apiPost({
        baseUrl: this.config!.baseUrl,
        endpoint: "ilink/bot/getuploadurl",
        body: {
          ...body,
          base_info: buildBaseInfo(this.config!.botAgent),
        },
        token: this.config!.token,
        botAgent: this.config!.botAgent,
        label: "weixin.getuploadurl",
        timeoutMs: API_TIMEOUT_MS,
      });
      assertIlinkOk(response, "weixin.getuploadurl");
      return response;
    });
    const parsed = JSON.parse(raw) as GetUploadUrlResp;
    if (!parsed.upload_param && !parsed.upload_full_url) {
      throw new Error(`weixin.getuploadurl returned no upload URL: ${raw}`);
    }
    return parsed;
  }

  private async downloadMessageMedia(message: WeixinMessage): Promise<DownloadedMedia> {
    const result: DownloadedMedia = { imagePaths: [], filePaths: [], tempDir: null };
    let mediaIndex = 0;

    const ensureTempDir = async () => {
      result.tempDir ??= await mkdtemp(path.join(tmpdir(), "anybot-weixin-media-"));
      return result.tempDir;
    };

    for (const item of message.item_list ?? []) {
      if (item.type === MessageItemType.IMAGE && item.image_item?.media) {
        const tempDir = await ensureTempDir();
        const filePath = path.join(tempDir, `image-${mediaIndex++}${inferImageExtension(item.image_item)}`);
        await downloadCdnMedia(item.image_item.media, item.image_item.aeskey, filePath);
        result.imagePaths.push(filePath);
      } else if (item.type === MessageItemType.FILE && item.file_item?.media) {
        const tempDir = await ensureTempDir();
        const fileName = safeIncomingFileName(item.file_item.file_name || `file-${mediaIndex}.bin`);
        const filePath = path.join(tempDir, `${mediaIndex++}-${fileName}`);
        await downloadCdnMedia(item.file_item.media, undefined, filePath);
        if (isSupportedImagePath(filePath)) {
          result.imagePaths.push(filePath);
        } else {
          result.filePaths.push({ name: fileName, path: filePath });
        }
      }
    }

    return result;
  }

  private async notifyStart(): Promise<void> {
    if (!this.config?.token) return;
    try {
      await apiPost({
        baseUrl: this.config.baseUrl,
        endpoint: "ilink/bot/msg/notifystart",
        body: { base_info: buildBaseInfo(this.config.botAgent) },
        token: this.config.token,
        botAgent: this.config.botAgent,
        label: "weixin.notifystart",
        timeoutMs: 10_000,
      });
    } catch (error) {
      logger.warn("weixin.notifystart.failed", { error });
    }
  }

  private async notifyStop(): Promise<void> {
    if (!this.config?.token) return;
    try {
      await apiPost({
        baseUrl: this.config.baseUrl,
        endpoint: "ilink/bot/msg/notifystop",
        body: { base_info: buildBaseInfo(this.config.botAgent) },
        token: this.config.token,
        botAgent: this.config.botAgent,
        label: "weixin.notifystop",
        timeoutMs: 10_000,
      });
    } catch (error) {
      logger.warn("weixin.notifystop.failed", { error });
    }
  }
}

function buildIncomingUserText(rawText: string, media: DownloadedMedia): string {
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

function buildCdnMediaRef(uploaded: UploadedMedia): CDNMedia {
  return {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(uploaded.aeskeyHex, "utf-8").toString("base64"),
    encrypt_type: 1,
  };
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function decodeAesKey(encoded?: string): Buffer {
  const value = encoded?.trim();
  if (!value) {
    throw new Error("Missing Weixin media AES key");
  }
  if (/^[0-9a-f]{32}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) {
    return decoded;
  }

  const decodedText = decoded.toString("utf-8").trim();
  if (/^[0-9a-f]{32}$/i.test(decodedText)) {
    return Buffer.from(decodedText, "hex");
  }

  throw new Error("Invalid Weixin media AES key");
}

function buildCdnUploadUrl(params: {
  uploadParam?: string;
  uploadFullUrl?: string;
  filekey: string;
}): string {
  if (params.uploadFullUrl?.trim()) {
    return params.uploadFullUrl.trim();
  }
  if (!params.uploadParam?.trim()) {
    throw new Error("Missing Weixin CDN upload param");
  }
  return `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

function buildCdnDownloadUrl(media: CDNMedia): string {
  const encryptedQueryParam = media.encrypt_query_param?.trim();
  if (!encryptedQueryParam) {
    throw new Error("Missing Weixin CDN download param");
  }
  return `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

async function uploadBufferToCdn(params: {
  plaintext: Buffer;
  uploadParam?: string;
  uploadFullUrl?: string;
  filekey: string;
  aeskey: Buffer;
}): Promise<string> {
  const ciphertext = encryptAesEcb(params.plaintext, params.aeskey);
  const url = buildCdnUploadUrl(params);
  let lastError: unknown;

  for (let attempt = 1; attempt <= WEIXIN_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      }, CDN_UPLOAD_TIMEOUT_MS);
      if (res.status >= 400 && res.status < 500) {
        const detail = res.headers.get("x-error-message") || await res.text();
        throw new Error(`Weixin CDN upload client error ${res.status}: ${detail}`);
      }
      if (res.status !== 200) {
        const detail = res.headers.get("x-error-message") || `status ${res.status}`;
        throw new Error(`Weixin CDN upload server error: ${detail}`);
      }
      const downloadParam = res.headers.get("x-encrypted-param");
      if (!downloadParam) {
        throw new Error("Weixin CDN upload response missing x-encrypted-param");
      }
      return downloadParam;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.includes("client error")) {
        throw error;
      }
      if (attempt < WEIXIN_RETRY_ATTEMPTS) {
        logger.warn("weixin.cdn_upload.retry", { attempt, error });
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Weixin CDN upload failed");
}

async function downloadCdnMedia(media: CDNMedia, imageAesKey: string | undefined, filePath: string): Promise<void> {
  const key = decodeAesKey(imageAesKey || media.aes_key);
  const url = buildCdnDownloadUrl(media);
  await retryWeixinOperation("weixin.cdn_download", async () => {
    const res = await fetchWithTimeout(url, {
      method: "GET",
    }, CDN_DOWNLOAD_TIMEOUT_MS);
    if (!res.ok) {
      throw new Error(`Weixin CDN download failed ${res.status}: ${await res.text()}`);
    }
    const ciphertext = Buffer.from(await res.arrayBuffer());
    const plaintext = decryptAesEcb(ciphertext, key);
    await writeFile(filePath, plaintext);
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function inferImageExtension(image: ImageItem): string {
  let urlExt = "";
  try {
    urlExt = image.url ? path.extname(new URL(image.url, "https://example.invalid").pathname).toLowerCase() : "";
  } catch {
    urlExt = "";
  }
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".ico"].includes(urlExt)) {
    return urlExt;
  }
  return ".jpg";
}

function safeIncomingFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return base || "file.bin";
}

function assertIlinkOk(raw: string, label: string): void {
  try {
    const parsed = JSON.parse(raw) as { ret?: number; errcode?: number; errmsg?: string };
    const failed =
      (parsed.ret !== undefined && parsed.ret !== 0) ||
      (parsed.errcode !== undefined && parsed.errcode !== 0);
    if (failed) {
      throw new Error(`${label} failed: ${raw}`);
    }
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}

async function retryWeixinOperation<T>(
  label: string,
  operation: () => Promise<T>,
  attempts = WEIXIN_RETRY_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableWeixinError(error)) {
        throw error;
      }
      logger.warn("weixin.operation.retry", {
        label,
        attempt,
        error,
      });
      await sleep(500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

function isRetryableWeixinError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message;
  if (/\b4\d\d:/.test(message) && !/\b429:/.test(message)) {
    return false;
  }
  if (/client error 4\d\d/i.test(message) && !/client error 429/i.test(message)) {
    return false;
  }
  return true;
}

function normalizeConfig(config: Partial<WeixinChannelConfig>): WeixinChannelConfig {
  return {
    ...config,
    enabled: !!config.enabled,
    baseUrl: config.baseUrl?.trim() || DEFAULT_BASE_URL,
    botType: config.botType?.trim() || DEFAULT_BOT_TYPE,
    botAgent: config.botAgent?.trim() || DEFAULT_BOT_AGENT,
    accountId: config.accountId?.trim() || "",
    token: config.token?.trim() || "",
    ownerChatId: config.ownerChatId?.trim() || "",
  };
}

async function apiGet(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(new URL(params.endpoint, ensureTrailingSlash(params.baseUrl)), {
      method: "GET",
      headers: buildCommonHeaders(),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${params.label} ${res.status}: ${raw}`);
    return raw;
  } finally {
    clearTimeout(t);
  }
}

async function apiPost(params: {
  baseUrl: string;
  endpoint: string;
  body: unknown;
  token?: string;
  botAgent?: string;
  timeoutMs: number;
  label: string;
  signal?: AbortSignal;
}): Promise<string> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (params.signal?.aborted) controller.abort();
  params.signal?.addEventListener("abort", abortFromParent, { once: true });
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(new URL(params.endpoint, ensureTrailingSlash(params.baseUrl)), {
      method: "POST",
      headers: buildHeaders(params.token),
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${params.label} ${res.status}: ${raw}`);
    return raw;
  } finally {
    clearTimeout(t);
    params.signal?.removeEventListener("abort", abortFromParent);
  }
}

function buildHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

function buildCommonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

function buildBaseInfo(botAgent?: string): Record<string, string> {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: sanitizeBotAgent(botAgent),
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function sanitizeBotAgent(raw?: string): string {
  const value = raw?.trim() || DEFAULT_BOT_AGENT;
  return /^[\x20-\x7E]{1,256}$/.test(value) ? value : DEFAULT_BOT_AGENT;
}

function extractText(message: WeixinMessage): string {
  const parts: string[] = [];
  for (const item of message.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      parts.push(item.voice_item.text);
    }
  }
  return parts.join("\n");
}

function displayQRCode(qrcodeUrl: string): void {
  try {
    const qrterm = require("qrcode-terminal") as {
      generate: (input: string, opts?: { small?: boolean }) => void;
    };
    qrterm.generate(qrcodeUrl, { small: true });
  } catch {
    // The URL is printed by the caller as a fallback.
  }
}

async function generateQRCodeDataUrl(qrcodeUrl: string): Promise<string | undefined> {
  try {
    const qrcode = require("qrcode") as {
      toDataURL: (input: string, opts?: Record<string, unknown>) => Promise<string>;
    };
    return await qrcode.toDataURL(qrcodeUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 260,
      color: { dark: "#111827", light: "#ffffff" },
    });
  } catch (error) {
    logger.warn("weixin.qrcode_data_url.failed", { error });
    return undefined;
  }
}

function setWeixinLoginStatus(next: Partial<WeixinLoginStatus>): void {
  loginStatus = {
    ...loginStatus,
    ...next,
    updatedAt: Date.now(),
  };
}

const VERIFY_CODE_INPUT_TIMEOUT_MS = 120_000;

async function readVerifyCodeFromStdin(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("当前运行环境无法从终端输入验证码，请重新扫码并在手机微信上直接确认");
  }
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let input = "";
    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("验证码输入超时，请重新扫码登录"));
    }, VERIFY_CODE_INPUT_TIMEOUT_MS);
    const onData = (chunk: Buffer | string) => {
      input += chunk.toString();
      if (input.includes("\n")) {
        cleanup();
        resolve(input.trim());
      }
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
  });
}

function loadSyncBuf(): string {
  try {
    if (!existsSync(SYNC_PATH)) return "";
    const parsed = JSON.parse(readFileSync(SYNC_PATH, "utf-8")) as { get_updates_buf?: string };
    return typeof parsed.get_updates_buf === "string" ? parsed.get_updates_buf : "";
  } catch {
    return "";
  }
}

function saveSyncBuf(getUpdatesBuf: string): void {
  mkdirSync(path.dirname(SYNC_PATH), { recursive: true });
  writeFileSync(SYNC_PATH, JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0), "utf-8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
