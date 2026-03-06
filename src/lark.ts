import * as Lark from "@larksuiteoapi/node-sdk";
import { createReadStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IncomingMessage } from "./types.js";
import { parseIncomingImageKey, getImageExtension, parseReplyPayload } from "./message.js";

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
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

export async function sendImage(
  client: Lark.Client,
  chatId: string,
  imagePath: string,
): Promise<void> {
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
}

export async function sendReply(
  client: Lark.Client,
  chatId: string,
  reply: string,
  workdir: string,
): Promise<void> {
  const payload = parseReplyPayload(reply, workdir);

  if (payload.text) {
    await sendText(client, chatId, payload.text);
  } else if (payload.imagePaths.length > 0) {
    await sendText(client, chatId, "图片已发送。");
  }

  for (const imagePath of payload.imagePaths) {
    await sendImage(client, chatId, imagePath);
  }

  if (!payload.text && payload.imagePaths.length === 0) {
    await sendText(client, chatId, reply);
  }
}

export async function sendAckReaction(
  client: Lark.Client,
  messageId: string,
  emojiType: string,
): Promise<void> {
  if (!emojiType) return;

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
  return filePath;
}
