import { existsSync } from "node:fs";
import path from "node:path";

import type { ReplyPayload, TextMessageContent, ImageMessageContent } from "./types.js";

export function parseIncomingText(content: string): string {
  try {
    const parsed = JSON.parse(content) as TextMessageContent;
    return (parsed.text || "").trim();
  } catch {
    return content.trim();
  }
}

export function sanitizeUserText(text: string): string {
  return text.replace(/<at[^>]*>.*?<\/at>/g, "").trim();
}

export function parseIncomingImageKey(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as ImageMessageContent;
    return parsed.image_key?.trim() || null;
  } catch {
    return null;
  }
}

export function getImageExtension(contentType?: string): string {
  switch ((contentType || "").split(";")[0].trim().toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/tiff":
      return ".tiff";
    case "image/bmp":
      return ".bmp";
    case "image/x-icon":
    case "image/vnd.microsoft.icon":
      return ".ico";
    default:
      return ".img";
  }
}

const SUPPORTED_IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".tif", ".bmp", ".ico",
]);

export function isSupportedImagePath(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export function normalizeCandidateImagePath(
  filePath: string,
  workdir: string,
): string | null {
  const normalized = filePath.trim();
  if (!normalized || !isSupportedImagePath(normalized)) {
    return null;
  }

  const resolved = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(workdir, normalized);

  return existsSync(resolved) ? resolved : null;
}

export function parseReplyPayload(reply: string, workdir: string): ReplyPayload {
  const imagePaths = new Set<string>();

  const markdownImagePattern = /!\[[^\]]*]\(([^)\n]+)\)/g;
  for (const match of reply.matchAll(markdownImagePattern)) {
    const imagePath = normalizeCandidateImagePath(match[1] || "", workdir);
    if (imagePath) {
      imagePaths.add(imagePath);
    }
  }

  const plainPathPattern =
    /(^|\n)(\.{0,2}\/?[^\s<>"')\]]+\.(?:png|jpe?g|webp|gif|tiff?|bmp|ico))(?=\n|$)/gi;
  for (const match of reply.matchAll(plainPathPattern)) {
    const imagePath = normalizeCandidateImagePath(match[2] || "", workdir);
    if (imagePath) {
      imagePaths.add(imagePath);
    }
  }

  const inlineCodePathPattern = /`([^`\n]+\.(?:png|jpe?g|webp|gif|tiff?|bmp|ico))`/gi;
  for (const match of reply.matchAll(inlineCodePathPattern)) {
    const imagePath = normalizeCandidateImagePath(match[1] || "", workdir);
    if (imagePath) {
      imagePaths.add(imagePath);
    }
  }

  let text = reply.replace(markdownImagePattern, (fullMatch, imgPath: string) => {
    return normalizeCandidateImagePath(imgPath, workdir) ? "" : fullMatch;
  });
  text = text.replace(plainPathPattern, (fullMatch, prefix: string, imgPath: string) => {
    return normalizeCandidateImagePath(imgPath, workdir) ? prefix : fullMatch;
  });
  text = text.replace(inlineCodePathPattern, (fullMatch, imgPath: string) => {
    return normalizeCandidateImagePath(imgPath, workdir) ? "" : fullMatch;
  });
  text = text.trim();
  text = text.replace(/\n{3,}/g, "\n\n");

  return {
    text,
    imagePaths: [...imagePaths],
  };
}
