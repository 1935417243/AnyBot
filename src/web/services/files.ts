import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { logger } from "../../logger.js";
import { getWorkdir } from "../../shared.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif", ".heic", ".heif", ".avif"]);
const HTML_EXTS = new Set([".html", ".htm"]);
const MAX_FILE_LIST_ITEMS = 5000;
const DEFAULT_WORKSPACE_EXCLUDED_DIRS = ["artifacts", "tem", "tmp"];
const execFile = promisify(execFileCallback);

export type MentionableFile = {
  name: string;
  path: string;
};

export type MentionableFileOptions = {
  allowWorkspaceScan?: boolean;
  excludeDefaultWorkspaceDirs?: boolean;
};

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isHtmlFile(filePath: string): boolean {
  return HTML_EXTS.has(path.extname(filePath).toLowerCase());
}

export function resolveLocalFilePath(filePath: string): string {
  let value = String(filePath || "").trim();
  if (!value || value.includes("\0")) {
    throw new Error("路径无效");
  }

  if (/^file:/i.test(value)) {
    value = fileURLToPath(value);
  } else if (value === "~" || /^~[\\/]/.test(value)) {
    value = path.join(os.homedir(), value.slice(2));
  } else if (!path.isAbsolute(value)) {
    throw new Error("只允许打开绝对路径");
  }

  return path.resolve(value);
}

export function getUploadDir(): string {
  return path.join(getWorkdir(), "tmp", "uploads");
}

function splitNul(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function normalizeRelativeFilePath(filePath: string): string | null {
  const normalized = filePath.split(path.sep).join(path.posix.sep).replace(/^\.\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function isHiddenRelativePath(relativePath: string): boolean {
  return relativePath.split("/").some((part) => part.startsWith("."));
}

function isDefaultWorkspaceExcludedPath(relativePath: string): boolean {
  return DEFAULT_WORKSPACE_EXCLUDED_DIRS.some((dir) => relativePath === dir || relativePath.startsWith(`${dir}/`));
}

function shouldExcludeMentionablePath(relativePath: string, options: MentionableFileOptions): boolean {
  return isHiddenRelativePath(relativePath) ||
    (!!options.excludeDefaultWorkspaceDirs && isDefaultWorkspaceExcludedPath(relativePath));
}

export function isMentionableRelativeFilePath(relativePath: string, options: MentionableFileOptions = {}): boolean {
  const normalized = normalizeRelativeFilePath(relativePath);
  return !!normalized && !shouldExcludeMentionablePath(normalized, options);
}

function toMentionableFile(relativePath: string, options: MentionableFileOptions = {}): MentionableFile | null {
  const normalized = normalizeRelativeFilePath(relativePath);
  if (!normalized) return null;
  if (shouldExcludeMentionablePath(normalized, options)) return null;
  return {
    name: path.posix.basename(normalized),
    path: normalized,
  };
}

async function isGitWorktree(workdir: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workdir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return String(stdout).trim() === "true";
  } catch {
    return false;
  }
}

async function listGitManagedFiles(workdir: string, options: MentionableFileOptions): Promise<MentionableFile[]> {
  const { stdout } = await execFile("git", ["ls-files", "-z"], {
    cwd: workdir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const result: MentionableFile[] = [];
  for (const filePath of splitNul(String(stdout))) {
    if (result.length >= MAX_FILE_LIST_ITEMS) break;
    const mentionable = toMentionableFile(filePath, options);
    if (mentionable) result.push(mentionable);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function scanWorkspaceFiles(workdir: string, options: MentionableFileOptions): Promise<MentionableFile[]> {
  const root = path.resolve(workdir);
  const result: MentionableFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (result.length >= MAX_FILE_LIST_ITEMS) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (result.length >= MAX_FILE_LIST_ITEMS) return;

      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath);
      const normalizedPath = normalizeRelativeFilePath(relativePath);
      if (!normalizedPath || shouldExcludeMentionablePath(normalizedPath, options)) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const mentionable = toMentionableFile(normalizedPath, options);
      if (mentionable) result.push(mentionable);
    }
  }

  await walk(root);
  return result;
}

export async function listMentionableFiles(
  workdir: string,
  options: MentionableFileOptions = {},
): Promise<MentionableFile[]> {
  const root = path.resolve(workdir);
  const stat = await fs.promises.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];

  if (await isGitWorktree(root)) {
    try {
      return await listGitManagedFiles(root, options);
    } catch (error) {
      logger.warn("web.files.git_file_list_failed", { workdir: root, error });
      return [];
    }
  }

  if (!options.allowWorkspaceScan) return [];

  try {
    return await scanWorkspaceFiles(root, options);
  } catch (error) {
    logger.warn("web.files.workspace_file_scan_failed", { workdir: root, error });
    return [];
  }
}
