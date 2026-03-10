import * as Lark from "@larksuiteoapi/node-sdk";
import { createReadStream } from "node:fs";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IncomingMessage } from "./types.js";
import { parseIncomingImageKey, getImageExtension, parseReplyPayload } from "./message.js";
import { includeContentInLogs, logger, rawLogString } from "./logger.js";

const shouldLogContent = includeContentInLogs();

type LarkCardElement =
  | {
      tag: "markdown";
      content: string;
      text_align?: "left" | "center" | "right";
      text_size?: "normal" | "heading" | "notation";
    }
  | {
      tag: "hr";
    };

function splitMarkdownBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (current.length === 0) return;
    const block = current.join("\n").trim();
    if (block) {
      blocks.push(block);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inCodeFence && current.length > 0) {
        flush();
      }
      current.push(line);
      inCodeFence = !inCodeFence;
      if (!inCodeFence) {
        flush();
      }
      continue;
    }

    if (inCodeFence) {
      current.push(line);
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    const isBullet = /^([-*+]|\d+\.)\s+/.test(trimmed);
    const previousIsBullet =
      current.length > 0 && /^([-*+]|\d+\.)\s+/.test(current[current.length - 1]!.trim());

    if (isBullet && current.length > 0 && !previousIsBullet) {
      flush();
    }

    current.push(line);
  }

  flush();
  return blocks;
}

function buildCardElements(text: string): LarkCardElement[] {
  const blocks = splitMarkdownBlocks(text);
  if (blocks.length === 0) {
    return [
      {
        tag: "markdown",
        content: text,
      },
    ];
  }

  return blocks.flatMap((block, index) => {
    const elements: LarkCardElement[] = [
      {
        tag: "markdown",
        content: block,
      },
    ];

    if (index < blocks.length - 1) {
      elements.push({ tag: "hr" });
    }

    return elements;
  });
}

function toInteractiveCardContent(text: string): string {
  return JSON.stringify({
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: "黑墙 回复",
      },
      template: "blue",
    },
    elements: buildCardElements(text),
  });
}

async function sendPlainText(
  client: Lark.Client,
  chatId: string,
  text: string,
): Promise<void> {
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

type LarkFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

function detectLarkFileType(filePath: string): LarkFileType {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".opus":
      return "opus";
    case ".mp4":
      return "mp4";
    case ".pdf":
      return "pdf";
    case ".doc":
    case ".docx":
      return "doc";
    case ".xls":
    case ".xlsx":
      return "xls";
    case ".ppt":
    case ".pptx":
      return "ppt";
    default:
      return "stream";
  }
}

function formatCardFallbackText(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function isCardContentError(error: unknown): boolean {
  const maybeError = error as {
    code?: number;
    msg?: string;
    message?: string;
    response?: { code?: number; msg?: string };
  };
  const code = maybeError.code ?? maybeError.response?.code;
  const message = maybeError.msg || maybeError.response?.msg || maybeError.message || "";
  return code === 230028 || /interactive|card|content/i.test(message);
}

export function createLarkClients(appId: string, appSecret: string) {
  const client = new Lark.Client({ appId, appSecret });
  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.info,
  });
  return { client, wsClient, EventDispatcher: Lark.EventDispatcher };
}

export async function sendText(
  client: Lark.Client,
  chatId: string,
  text: string,
): Promise<void> {
  logger.debug("lark.send_text", {
    chatId,
    textChars: text.length,
    ...(shouldLogContent
      ? {
          text: rawLogString(text),
        }
      : {}),
  });
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: toInteractiveCardContent(text),
    },
  }).catch(async (error: unknown) => {
    if (!isCardContentError(error)) {
      throw error;
    }
    logger.warn("lark.send_text.card_fallback", {
      chatId,
      error: (error as { message?: string })?.message || String(error),
    });
    await sendPlainText(client, chatId, formatCardFallbackText(text));
  });
}

export async function sendImage(
  client: Lark.Client,
  chatId: string,
  imagePath: string,
): Promise<void> {
  logger.info("lark.send_image.start", {
    chatId,
    imagePath,
  });
  const upload = await client.im.image.create({
    data: {
      image_type: "message",
      image: createReadStream(imagePath),
    },
  });

  const imageKey = upload?.image_key;
  if (!imageKey) {
    throw new Error(`上传图片失败：${imagePath}`);
  }

  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
    },
  });
  logger.info("lark.send_image.success", {
    chatId,
    imagePath,
    imageKey,
  });
}

export async function sendFile(
  client: Lark.Client,
  chatId: string,
  filePath: string,
): Promise<void> {
  logger.info("lark.send_file.start", {
    chatId,
    filePath,
  });

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`不是可发送的文件：${filePath}`);
  }
  if (fileStat.size <= 0) {
    throw new Error(`文件为空，无法发送：${filePath}`);
  }
  if (fileStat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `文件超过 30MB，无法发送：${path.basename(filePath)} (${fileStat.size} bytes)`,
    );
  }

  const upload = await client.im.file.create({
    data: {
      file_type: detectLarkFileType(filePath),
      file_name: path.basename(filePath),
      file: createReadStream(filePath),
    },
  });

  const fileKey = upload?.file_key;
  if (!fileKey) {
    throw new Error(`上传文件失败：${filePath}`);
  }

  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    },
  });

  logger.info("lark.send_file.success", {
    chatId,
    filePath,
    fileKey,
    fileSize: fileStat.size,
  });
}

export async function sendReply(
  client: Lark.Client,
  chatId: string,
  reply: string,
  workdir: string,
): Promise<void> {
  const payload = parseReplyPayload(reply, workdir);
  logger.info("lark.send_reply", {
    chatId,
    textChars: payload.text.length,
    imageCount: payload.imagePaths.length,
    fileCount: payload.filePaths.length,
    ...(shouldLogContent
      ? {
          reply: rawLogString(reply),
          text: rawLogString(payload.text),
        }
      : {}),
  });

  if (payload.text) {
    await sendText(client, chatId, payload.text);
  } else if (payload.imagePaths.length > 0 || payload.filePaths.length > 0) {
    await sendText(client, chatId, "请查收~");
  }

  for (const imagePath of payload.imagePaths) {
    await sendImage(client, chatId, imagePath);
  }

  for (const filePath of payload.filePaths) {
    await sendFile(client, chatId, filePath);
  }

  if (!payload.text && payload.imagePaths.length === 0 && payload.filePaths.length === 0) {
    await sendText(client, chatId, reply);
  }
}

export async function sendAckReaction(
  client: Lark.Client,
  messageId: string,
  emojiType: string,
): Promise<void> {
  if (!emojiType) return;

  logger.debug("lark.send_ack_reaction", {
    messageId,
    emojiType,
  });
  await client.im.messageReaction.create({
    path: { message_id: messageId },
    data: { reaction_type: { emoji_type: emojiType } },
  });
}

export async function downloadImageFromMessage(
  client: Lark.Client,
  message: IncomingMessage,
): Promise<string> {
  const imageKey = parseIncomingImageKey(message.content);
  if (!imageKey) {
    throw new Error(`无法解析图片消息内容：${message.content}`);
  }

  logger.info("lark.download_image.start", {
    messageId: message.message_id,
    chatId: message.chat_id,
    imageKey,
  });

  const response = await client.im.messageResource.get({
    path: {
      message_id: message.message_id,
      file_key: imageKey,
    },
    params: { type: "image" },
  });

  const tempDir = await mkdtemp(path.join(tmpdir(), "codex-feishu-image-"));
  const contentType =
    response.headers?.["content-type"] || response.headers?.["Content-Type"];
  const filePath = path.join(
    tempDir,
    `incoming${getImageExtension(Array.isArray(contentType) ? contentType[0] : contentType)}`,
  );

  await response.writeFile(filePath);
  logger.info("lark.download_image.success", {
    messageId: message.message_id,
    chatId: message.chat_id,
    imageKey,
    filePath,
    contentType: Array.isArray(contentType) ? contentType[0] : contentType,
  });
  return filePath;
}
