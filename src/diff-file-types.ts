import path from "node:path";

const SUPPRESSED_DIFF_EXTENSIONS = new Set([
  ".7z",
  ".bak",
  ".class",
  ".db",
  ".dll",
  ".doc",
  ".docx",
  ".dump",
  ".dylib",
  ".exe",
  ".fig",
  ".gif",
  ".gz",
  ".jar",
  ".jpeg",
  ".jpg",
  ".log",
  ".map",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".psd",
  ".rar",
  ".sketch",
  ".so",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".war",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

const SUPPRESSED_DIFF_SUFFIXES = [".min.js"];

const BINARY_DIFF_EXTENSIONS = new Set([
  ...SUPPRESSED_DIFF_EXTENSIONS,
  ".a",
  ".ai",
  ".apk",
  ".avi",
  ".avif",
  ".bin",
  ".bmp",
  ".dmg",
  ".eot",
  ".heic",
  ".icns",
  ".ico",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".tgz",
  ".tif",
  ".tiff",
  ".ttf",
  ".wav",
  ".wasm",
  ".webm",
  ".woff",
  ".woff2",
]);

const BINARY_DIFF_SUFFIXES = [...SUPPRESSED_DIFF_SUFFIXES];

export function shouldSuppressDiffFile(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  if (SUPPRESSED_DIFF_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix))) return true;
  return SUPPRESSED_DIFF_EXTENSIONS.has(path.extname(normalizedPath));
}

export function hasBinaryDiffFileType(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  if (BINARY_DIFF_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix))) return true;
  return BINARY_DIFF_EXTENSIONS.has(path.extname(normalizedPath));
}
