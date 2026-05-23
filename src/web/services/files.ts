import path from "node:path";
import { getWorkdir } from "../../shared.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif", ".heic", ".heif", ".avif"]);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export function getUploadDir(): string {
  return path.join(getWorkdir(), "tmp", "uploads");
}
