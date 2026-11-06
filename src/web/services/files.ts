import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { logger } from "../../logger.js";
import { getWorkdir } from "../../shared.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif", ".heic", ".heif", ".avif"]);
const HTML_EXTS = new Set([".html", ".htm"]);
const MAX_FILE_LIST_ITEMS = 5000;
const DEFAULT_WORKSPACE_EXCLUDED_DIRS = ["artifacts", "tem", "tmp"];
const execFile = promisify(execFileCallback);
/** 扫描模式下始终跳过的依赖、缓存和覆盖率目录名（小写，按目录名匹配，不区分大小写）。 */
const ALWAYS_EXCLUDED_SCAN_DIR_NAMES = new Set([
  "node_modules",
  "bower_components",
  "jspm_packages",
  "__pycache__",
  "venv",
  "site-packages",
  "pods",
  "deriveddata",
  "coverage",
  "htmlcov",
]);
/** 扫描模式下始终跳过的目录后缀（小写），主要是 macOS 包目录和 Python 打包元数据。 */
const ALWAYS_EXCLUDED_SCAN_DIR_SUFFIXES = [
  ".app",
  ".framework",
  ".bundle",
  ".xcarchive",
  ".dsym",
  ".photoslibrary",
  ".musiclibrary",
  ".egg-info",
];
/** 常见构建产物目录名（小写）；只在当前目录没有任何 .gitignore 规则可参考时才按名字跳过。 */
const BUILD_OUTPUT_SCAN_DIR_NAMES = new Set(["dist", "build", "out", "target"]);
/** 单次扫描最多读取的目录项总数，防止大量被排除的文件让遍历白跑。 */
const MAX_SCAN_ENTRIES = 50_000;
/** 单次扫描的最大目录深度，扫描根目录为 0。 */
const MAX_SCAN_DEPTH = 12;
/** 单次扫描的耗时上限，兜底网络盘、iCloud、外接慢盘等目录。 */
const SCAN_TIME_BUDGET_MS = 1500;
/** 单次扫描最多对多少个嵌套 git 仓库调用 git ls-files。 */
const MAX_NESTED_GIT_REPOS = 30;
/** 单个 .gitignore 允许读取的最大字节数，超出时忽略该文件。 */
const MAX_GITIGNORE_BYTES = 256 * 1024;
/** 扫描结果缓存的新鲜期，期内直接复用。 */
const SCAN_CACHE_FRESH_MS = 30_000;
/** 扫描结果缓存的最长可用期；超过新鲜期但未超过该期限时先返回旧结果并在后台刷新。 */
const SCAN_CACHE_STALE_MS = 5 * 60_000;
/** 最多缓存多少个目录的扫描结果。 */
const MAX_SCAN_CACHE_ENTRIES = 10;
/** “是否 git 工作区”判断结果的缓存有效期。 */
const GIT_WORKTREE_CACHE_MS = 30_000;
/** 最多缓存多少个目录的“是否 git 工作区”判断结果。 */
const MAX_GIT_WORKTREE_CACHE_ENTRIES = 50;

export type MentionableFile = {
  name: string;
  path: string;
};

export type MentionableFileOptions = {
  excludeDefaultWorkspaceDirs?: boolean;
};

/** 可引用文件列表及其完整性。 */
export type MentionableFileList = {
  /** 可引用文件。 */
  files: MentionableFile[];
  /** 列表是否因数量、深度、耗时上限或目录范围过大而不完整。 */
  truncated: boolean;
};

/** 某个目录下的 .gitignore 规则。 */
type GitignoreMatcher = {
  /** 规则所在目录相对扫描根目录的路径，根目录为空字符串。 */
  base: string;
  /** 解析后的忽略规则。 */
  rules: Ignore;
};

/** 广度优先扫描队列中的待处理目录。 */
type ScanQueueItem = {
  /** 目录绝对路径。 */
  absolutePath: string;
  /** 目录相对扫描根目录的 posix 路径，根目录为空字符串。 */
  relativePath: string;
  /** 目录深度，扫描根目录为 0。 */
  depth: number;
  /** 从根目录到当前目录生效的 .gitignore 规则，按由浅到深排列。 */
  matchers: GitignoreMatcher[];
};

/** 扫描结果缓存项。 */
type ScanCacheEntry = {
  /** 扫描结果。 */
  result: MentionableFileList;
  /** 扫描完成时间戳（毫秒）。 */
  createdAt: number;
};

/** “是否 git 工作区”判断结果的缓存项。 */
type GitWorktreeCacheEntry = {
  /** 目录是否位于 git 工作区内。 */
  isWorktree: boolean;
  /** 判断完成时间戳（毫秒）。 */
  checkedAt: number;
};

/** 按“目录 + 参数”缓存的扫描结果，Map 插入顺序即淘汰顺序。 */
const scanCache = new Map<string, ScanCacheEntry>();
/** 正在进行的扫描；同一目录的并发请求共用一次扫描。 */
const scanInflight = new Map<string, Promise<MentionableFileList>>();
/** 按目录缓存的“是否 git 工作区”判断结果，Map 插入顺序即淘汰顺序。 */
const gitWorktreeCache = new Map<string, GitWorktreeCacheEntry>();

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

async function scanWorkspaceFiles(workdir: string, options: MentionableFileOptions): Promise<MentionableFileList> {
  const root = path.resolve(workdir);
  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;
  const topLevelOnly = isBroadScanRoot(root);
  const files: MentionableFile[] = [];
  const queue: ScanQueueItem[] = [{ absolutePath: root, relativePath: "", depth: 0, matchers: [] }];
  let entriesRead = 0;
  let nestedGitRepos = 0;
  let truncated = false;

  for (let index = 0; index < queue.length; index++) {
    if (files.length >= MAX_FILE_LIST_ITEMS || entriesRead >= MAX_SCAN_ENTRIES || Date.now() >= deadline) {
      truncated = true;
      break;
    }

    const dir = queue[index];
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }
    entriesRead += entries.length;

    if (dir.depth > 0 && nestedGitRepos < MAX_NESTED_GIT_REPOS && entries.some((entry) => entry.name === ".git")) {
      nestedGitRepos++;
      const trackedFiles = await readGitTrackedFiles(dir.absolutePath, deadline);
      if (trackedFiles && trackedFiles.length > 0) {
        for (const filePath of trackedFiles) {
          if (files.length >= MAX_FILE_LIST_ITEMS) {
            truncated = true;
            break;
          }
          const mentionable = toMentionableFile(`${dir.relativePath}/${filePath}`, options);
          if (mentionable) files.push(mentionable);
        }
        continue;
      }
    }

    const matchers = await appendGitignoreMatcher(dir, entries);
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = dir.relativePath ? `${dir.relativePath}/${entry.name}` : entry.name;
      if (shouldExcludeMentionablePath(relativePath, options)) continue;

      if (entry.isDirectory()) {
        if (isExcludedScanDirectory(entry.name, matchers.length > 0)) continue;
        if (isGitignored(matchers, relativePath, true)) continue;
        if (topLevelOnly || dir.depth >= MAX_SCAN_DEPTH) {
          truncated = true;
          continue;
        }
        queue.push({
          absolutePath: path.join(dir.absolutePath, entry.name),
          relativePath,
          depth: dir.depth + 1,
          matchers,
        });
        continue;
      }
      if (!entry.isFile()) continue;
      if (isGitignored(matchers, relativePath, false)) continue;

      if (files.length >= MAX_FILE_LIST_ITEMS) {
        truncated = true;
        break;
      }
      files.push({ name: entry.name, path: relativePath });
    }
  }

  return { files, truncated };
}

export async function listMentionableFiles(
  workdir: string,
  options: MentionableFileOptions = {},
): Promise<MentionableFileList> {
  const root = path.resolve(workdir);
  const stat = await fs.promises.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) return { files: [], truncated: false };

  if (await isGitWorktreeCached(root)) {
    try {
      const files = await listGitManagedFiles(root, options);
      if (files.length > 0) {
        return { files, truncated: files.length >= MAX_FILE_LIST_ITEMS };
      }
    } catch (error) {
      logger.warn("web.files.git_file_list_failed", { workdir: root, error });
    }
  }

  try {
    return await getCachedWorkspaceScan(root, options);
  } catch (error) {
    logger.warn("web.files.workspace_file_scan_failed", { workdir: root, error });
    return { files: [], truncated: false };
  }
}

/** 返回扫描结果，优先复用缓存；缓存过了新鲜期时先返回旧结果并在后台刷新。 */
async function getCachedWorkspaceScan(root: string, options: MentionableFileOptions): Promise<MentionableFileList> {
  const key = `${options.excludeDefaultWorkspaceDirs ? 1 : 0}:${root}`;
  const cached = scanCache.get(key);
  const age = cached ? Date.now() - cached.createdAt : Number.POSITIVE_INFINITY;
  if (cached && age <= SCAN_CACHE_FRESH_MS) return cached.result;
  if (cached && age <= SCAN_CACHE_STALE_MS) {
    refreshWorkspaceScan(key, root, options).catch((error) => {
      logger.warn("web.files.workspace_file_scan_failed", { workdir: root, error });
    });
    return cached.result;
  }
  return refreshWorkspaceScan(key, root, options);
}

/** 重新扫描目录并写入缓存；同一目录已有扫描在进行时直接复用它。 */
function refreshWorkspaceScan(key: string, root: string, options: MentionableFileOptions): Promise<MentionableFileList> {
  const inflight = scanInflight.get(key);
  if (inflight) return inflight;

  const task = scanWorkspaceFiles(root, options)
    .then((result) => {
      scanCache.delete(key);
      scanCache.set(key, { result, createdAt: Date.now() });
      while (scanCache.size > MAX_SCAN_CACHE_ENTRIES) {
        const oldestKey = scanCache.keys().next().value;
        if (oldestKey === undefined) break;
        scanCache.delete(oldestKey);
      }
      return result;
    })
    .finally(() => {
      scanInflight.delete(key);
    });
  scanInflight.set(key, task);
  return task;
}

/** 根目录是文件系统根目录或包含用户主目录时视为范围过大，只列顶层文件，避免触发 macOS 隐私授权弹窗。 */
function isBroadScanRoot(root: string): boolean {
  if (root === path.parse(root).root) return true;
  const relativeHome = path.relative(root, os.homedir());
  return relativeHome === "" || (!relativeHome.startsWith("..") && !path.isAbsolute(relativeHome));
}

/** 判断扫描时是否按目录名跳过；构建产物目录只在没有 .gitignore 规则可参考时跳过。 */
function isExcludedScanDirectory(name: string, hasGitignoreRules: boolean): boolean {
  const lowerName = name.toLowerCase();
  if (ALWAYS_EXCLUDED_SCAN_DIR_NAMES.has(lowerName)) return true;
  if (ALWAYS_EXCLUDED_SCAN_DIR_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) return true;
  return !hasGitignoreRules && BUILD_OUTPUT_SCAN_DIR_NAMES.has(lowerName);
}

/** 当前目录有 .gitignore 时，返回追加了该目录规则的新规则链；否则原样返回父级规则链。 */
async function appendGitignoreMatcher(dir: ScanQueueItem, entries: fs.Dirent[]): Promise<GitignoreMatcher[]> {
  if (!entries.some((entry) => entry.name === ".gitignore" && entry.isFile())) return dir.matchers;

  const gitignorePath = path.join(dir.absolutePath, ".gitignore");
  try {
    const stat = await fs.promises.stat(gitignorePath);
    if (stat.size > MAX_GITIGNORE_BYTES) return dir.matchers;
    const content = await fs.promises.readFile(gitignorePath, "utf8");
    const rules = ignore({ allowRelativePaths: true }).add(content);
    return [...dir.matchers, { base: dir.relativePath, rules }];
  } catch {
    return dir.matchers;
  }
}

/** 按 git 语义判断路径是否被忽略：规则由浅到深依次生效，深层 .gitignore 可以覆盖浅层结果。 */
function isGitignored(matchers: GitignoreMatcher[], relativePath: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const matcher of matchers) {
    const localPath = matcher.base ? relativePath.slice(matcher.base.length + 1) : relativePath;
    const result = matcher.rules.test(isDirectory ? `${localPath}/` : localPath);
    if (result.ignored) {
      ignored = true;
    } else if (result.unignored) {
      ignored = false;
    }
  }
  return ignored;
}

/** 在嵌套 git 仓库中执行 git ls-files，受扫描截止时间约束；失败或超时返回 null。 */
async function readGitTrackedFiles(cwd: string, deadline: number): Promise<string[] | null> {
  const timeout = deadline - Date.now();
  if (timeout <= 0) return null;
  try {
    const { stdout } = await execFile("git", ["ls-files", "-z"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout,
    });
    return splitNul(String(stdout));
  } catch {
    return null;
  }
}

/** 带缓存的 git 工作区判断，避免每次打开 @ 文件列表都启动 git 进程。 */
async function isGitWorktreeCached(root: string): Promise<boolean> {
  const cached = gitWorktreeCache.get(root);
  if (cached && Date.now() - cached.checkedAt <= GIT_WORKTREE_CACHE_MS) return cached.isWorktree;

  const isWorktree = await isGitWorktree(root);
  gitWorktreeCache.delete(root);
  gitWorktreeCache.set(root, { isWorktree, checkedAt: Date.now() });
  while (gitWorktreeCache.size > MAX_GIT_WORKTREE_CACHE_ENTRIES) {
    const oldestKey = gitWorktreeCache.keys().next().value;
    if (oldestKey === undefined) break;
    gitWorktreeCache.delete(oldestKey);
  }
  return isWorktree;
}
