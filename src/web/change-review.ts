import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { hasBinaryDiffFileType, shouldSuppressDiffFile } from "../diff-file-types.js";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

export type ChangeReviewStatus = "pending" | "approved" | "reverted";
export type FileDiffType = "text" | "binary";

export type PublicFileChange = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  diff: string;
  diffType: FileDiffType;
  diffTruncated?: boolean;
  fullDiffAvailable?: boolean;
};

export type PublicChangeReview = {
  id: string;
  status: ChangeReviewStatus;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  files: PublicFileChange[];
  error?: string;
};

type StoredFileChange = PublicFileChange & {
  beforeContentBase64: string | null;
  afterContentBase64: string | null;
};

type StoredChangeReview = Omit<PublicChangeReview, "files"> & {
  workdir: string;
  createdAt: number;
  updatedAt: number;
  files: StoredFileChange[];
};

/** 落盘摘要中的单个文件，不含修改前后的完整内容 */
type StoredFileChangeSummary = Omit<StoredFileChange, "beforeContentBase64" | "afterContentBase64">;

/** 打开会话时读取的变更审核摘要，不含 base64 正文 */
type StoredChangeReviewSummary = Omit<StoredChangeReview, "files"> & {
  files: StoredFileChangeSummary[];
};

/** 变更审核的完整文件内容，只在查看 diff 和撤销时读取 */
type ChangeReviewContentPayload = {
  files: Array<{
    /** 相对工作区的路径，与摘要中的 path 对应 */
    path: string;
    /** 修改前内容；文件是新增时为 null */
    beforeContentBase64: string | null;
    /** 修改后内容；文件被删除时为 null */
    afterContentBase64: string | null;
  }>;
};

/** 用于判断文件是否被改动的元信息 */
type SnapshotFileStat = {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

type SnapshotFile = {
  exists: boolean;
  content: Buffer | null;
  /** 读取内容前记录的元信息；结束时元信息未变化即可跳过重新读取 */
  stat?: SnapshotFileStat;
};

export type ChangeSnapshot = {
  workdir: string;
  /** git 按 git status 比对；filesystem 按目录扫描比对；hinted 为工作区过大时的降级模式，只比对工具声明的文件 */
  mode: "git" | "filesystem" | "hinted";
  trackedAtStart: Set<string>;
  changedAtStart: Map<string, SnapshotFile>;
  filesAtStart: Map<string, SnapshotFile>;
  /** filesystem 模式开始时扫描到的全部可审查文件元信息，结束时据此识别新增、删除和修改 */
  statsAtStart: Map<string, SnapshotFileStat>;
  /** 开始时已存在但因字节预算或读取失败未保存内容的文件，缺少可靠基线时不生成审查 */
  uncapturedAtStart: Set<string>;
};

const dataDir =
  process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.join(process.cwd(), ".data");
const reviewDir = path.join(dataDir, "change-reviews");
const SNAPSHOT_SKIP_DIRS = new Set([".git", "node_modules", ".data", ".run", "tmp"]);
/** 非 git 工作区扫描时额外跳过的依赖、构建产物和缓存目录；工具显式声明的文件仍会纳入审查 */
const FILESYSTEM_SCAN_SKIP_DIRS = new Set([
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".gradle",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".cache",
  "dist",
  "build",
  "target",
  "coverage",
  "pods",
  "deriveddata",
]);
const ALWAYS_SNAPSHOT_FILES = ["CLAUDE.md"];
const DESKTOP_USER_DATA_REVIEW_FILES = new Set([
  "agents.md",
  "claude.md",
  "memory.md",
  "profile.md",
]);
const MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
/** 单次快照最多检查的目录项（非 git）或变更文件（git）数量，超出后降级为只审查工具声明的文件 */
const MAX_SNAPSHOT_ENTRIES = 10000;
/** 单次快照预读文件内容的总字节预算，超出部分只记录元信息 */
const MAX_SNAPSHOT_TOTAL_BYTES = 32 * 1024 * 1024;
/** 快照阶段 stat/读文件的并发上限 */
const SNAPSHOT_IO_CONCURRENCY = 16;
/** 生成审查 diff 的并发上限，每个变更文件会启动一个 git 进程 */
const REVIEW_DIFF_CONCURRENCY = 4;
/** diff 预览输出中 numstat 行预留的字节数 */
const DIFF_NUMSTAT_HEADROOM_BYTES = 4096;
const PUBLIC_DIFF_MAX_BYTES = 128 * 1024;
const PUBLIC_DIFF_MAX_LINES = 800;

async function ensureReviewDir(): Promise<void> {
  await fs.promises.mkdir(reviewDir, { recursive: true });
}

async function runGit(
  workdir: string,
  args: string[],
  opts: { allowFailure?: boolean; maxBuffer?: number } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workdir,
      encoding: "utf8",
      maxBuffer: opts.maxBuffer || 20 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (opts.allowFailure && typeof (error as { stdout?: unknown }).stdout === "string") {
      return (error as { stdout: string }).stdout;
    }
    throw error;
  }
}

async function runGitBuffer(
  workdir: string,
  args: string[],
  opts: { maxBuffer?: number } = {},
): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workdir,
    encoding: "buffer",
    maxBuffer: opts.maxBuffer || 50 * 1024 * 1024,
  });
  return stdout as Buffer;
}

async function runGitLimited(
  workdir: string,
  args: string[],
  maxBytes: number,
): Promise<{ stdout: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: workdir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;

      const remaining = maxBytes - totalBytes;
      if (remaining <= 0) {
        truncated = true;
        child.kill();
        return;
      }

      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        totalBytes += remaining;
        truncated = true;
        child.kill();
        return;
      }

      chunks.push(chunk);
      totalBytes += chunk.length;
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (!truncated && code !== 0 && code !== 1) {
        reject(new Error(`git diff failed: ${code ?? signal ?? "unknown"}`));
        return;
      }

      resolve({
        stdout: Buffer.concat(chunks).toString("utf8"),
        truncated,
      });
    });
  });
}

function splitNul(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function isDesktopRuntimeWorkdir(workdir: string): boolean {
  if (process.env.ANYBOT_DESKTOP !== "1") return false;
  return path.resolve(workdir) === path.dirname(path.resolve(dataDir));
}

function shouldSkipSnapshotPath(
  workdir: string,
  parts: string[],
): boolean {
  const normalizedParts = parts.map((part) => part.toLowerCase());
  if (normalizedParts.some((part) => SNAPSHOT_SKIP_DIRS.has(part))) return true;
  if (!isDesktopRuntimeWorkdir(workdir)) return false;

  return !DESKTOP_USER_DATA_REVIEW_FILES.has(normalizedParts.join(path.posix.sep));
}

function shouldReviewFile(workdir: string, filePath: string): boolean {
  return !shouldSuppressDiffFile(filePath) && normalizeSnapshotPath(workdir, filePath) !== null;
}

function normalizeSnapshotPath(workdir: string, filePath: string): string | null {
  const root = path.resolve(workdir);
  const absolutePath = path.resolve(root, filePath);
  if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) return null;

  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;

  const parts = relativePath.split(path.sep);
  if (shouldSkipSnapshotPath(root, parts)) return null;
  return parts.join(path.posix.sep);
}

function isPathInside(parentPath: string, childPath: string): boolean {
  return childPath === parentPath || childPath.startsWith(parentPath + path.sep);
}

function parsePorcelainPaths(output: string): string[] {
  const entries = splitNul(output);
  const paths = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (!filePath) continue;
    paths.add(filePath);

    if ((status.includes("R") || status.includes("C")) && entries[i + 1]) {
      paths.add(entries[i + 1]);
      i += 1;
    }
  }

  return Array.from(paths);
}

async function readReviewableFileSnapshot(
  workdir: string,
  relativePath: string,
): Promise<SnapshotFile | null> {
  const root = path.resolve(workdir);
  const normalizedPath = normalizeSnapshotPath(root, relativePath);
  if (!normalizedPath) return null;

  const filePath = path.resolve(root, normalizedPath);
  try {
    const lstat = await fs.promises.lstat(filePath);
    let stat = lstat;

    if (lstat.isSymbolicLink()) {
      const realPath = await fs.promises.realpath(filePath).catch(() => null);
      if (!realPath || !isPathInside(root, realPath)) return null;
      const linkedStat = await fs.promises.stat(filePath).catch(() => null);
      if (!linkedStat) return null;
      stat = linkedStat;
    }

    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_FILE_BYTES) return null;

    const content = await fs.promises.readFile(filePath);
    if (content.length > MAX_SNAPSHOT_FILE_BYTES) return null;
    return { exists: true, content, stat: toSnapshotFileStat(stat) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, content: null };
    }
    return null;
  }
}

export async function addPathsToChangeSnapshot(
  snapshot: ChangeSnapshot | null,
  filePaths: string[],
): Promise<void> {
  if (!snapshot) return;

  for (const filePath of filePaths) {
    const normalizedPath = normalizeSnapshotPath(snapshot.workdir, filePath);
    if (!normalizedPath) continue;
    if (snapshot.filesAtStart.has(normalizedPath) || snapshot.changedAtStart.has(normalizedPath)) {
      continue;
    }
    const fileSnapshot = await readReviewableFileSnapshot(snapshot.workdir, normalizedPath);
    if (fileSnapshot) snapshot.changedAtStart.set(normalizedPath, fileSnapshot);
  }
}

/** 扫描非 git 工作区内可审查文件的元信息（不读内容）；目录项超过上限时停止扫描并标记 truncated */
async function walkWorkspaceFiles(
  workdir: string,
): Promise<{ stats: Map<string, SnapshotFileStat>; truncated: boolean }> {
  const root = path.resolve(workdir);
  const filePaths: string[] = [];
  let visitedEntries = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) return;
      visitedEntries += 1;
      if (visitedEntries > MAX_SNAPSHOT_ENTRIES) {
        truncated = true;
        return;
      }

      const absolutePath = path.join(dir, entry.name);
      const relativeParts = path.relative(root, absolutePath).split(path.sep);
      if (entry.isDirectory()) {
        if (FILESYSTEM_SCAN_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        if (shouldSkipSnapshotPath(root, relativeParts)) continue;
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = relativeParts.join(path.posix.sep);
      if (!shouldReviewFile(root, relativePath)) continue;
      filePaths.push(relativePath);
    }
  }

  await walk(root);

  const stats = new Map<string, SnapshotFileStat>();
  await mapWithConcurrency(filePaths, SNAPSHOT_IO_CONCURRENCY, async (relativePath) => {
    const stat = await statReviewableFile(root, relativePath);
    if (stat) stats.set(relativePath, stat);
  });
  return { stats, truncated };
}

async function createFilesystemSnapshot(workdir: string): Promise<ChangeSnapshot | null> {
  const scan = await walkWorkspaceFiles(workdir);
  if (scan.truncated) {
    logger.warn("change_review.snapshot_degraded", {
      workdir,
      reason: "too_many_entries",
      limit: MAX_SNAPSHOT_ENTRIES,
    });
    return createHintedSnapshot(workdir);
  }

  const captured = await captureSnapshotContents(
    workdir,
    Array.from(scan.stats, ([filePath, stat]) => ({ path: filePath, size: stat.size })),
  );
  return {
    workdir,
    mode: "filesystem",
    trackedAtStart: new Set(),
    changedAtStart: new Map(),
    filesAtStart: captured.files,
    statsAtStart: scan.stats,
    uncapturedAtStart: captured.uncaptured,
  };
}

function decodeBase64(value: string | null): Buffer {
  return value ? Buffer.from(value, "base64") : Buffer.alloc(0);
}

function bufferEqualsBase64(buffer: Buffer | null, encoded: string | null): boolean {
  if (buffer === null) return encoded === null;
  if (encoded === null) return false;
  return buffer.equals(Buffer.from(encoded, "base64"));
}

function hasBinaryDiffExtension(relativePath: string): boolean {
  return hasBinaryDiffFileType(relativePath);
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.includes(0)) return true;

  let controlBytes = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) controlBytes += 1;
  }
  return controlBytes / sample.length > 0.03;
}

function detectDiffType(relativePath: string, before: Buffer, after: Buffer): FileDiffType {
  if (hasBinaryDiffExtension(relativePath)) return "binary";
  if (isLikelyBinary(before) || isLikelyBinary(after)) return "binary";
  return "text";
}

function inferDiffTypeFromDiff(diff: string): FileDiffType {
  return /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/.test(diff) ? "binary" : "text";
}

async function writeTempFile(content: Buffer): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "anybot-diff-"));
  const filePath = path.join(dir, "content");
  await fs.promises.writeFile(filePath, content);
  return filePath;
}

async function diffBuffers(relativePath: string, before: Buffer, after: Buffer): Promise<string> {
  const beforePath = await writeTempFile(before);
  const afterPath = await writeTempFile(after);
  try {
    const raw = await runGit(
      process.cwd(),
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", beforePath, afterPath],
      { allowFailure: true },
    );
    return raw
      .replace(/^diff --git .*$/m, `diff --git a/${relativePath} b/${relativePath}`)
      .replace(/^--- .*$/m, `--- a/${relativePath}`)
      .replace(/^\+\+\+ .*$/m, `+++ b/${relativePath}`)
      .trimEnd();
  } finally {
    await fs.promises.rm(path.dirname(beforePath), { recursive: true, force: true });
    await fs.promises.rm(path.dirname(afterPath), { recursive: true, force: true });
  }
}

function truncateDiffPreview(diff: string, alreadyTruncated = false): { diff: string; truncated: boolean } {
  let next = diff;
  let truncated = alreadyTruncated;

  if (Buffer.byteLength(next, "utf8") > PUBLIC_DIFF_MAX_BYTES) {
    next = Buffer.from(next, "utf8").subarray(0, PUBLIC_DIFF_MAX_BYTES).toString("utf8");
    truncated = true;
  }

  const lines = next.split("\n");
  if (lines.length > PUBLIC_DIFF_MAX_LINES) {
    next = lines.slice(0, PUBLIC_DIFF_MAX_LINES).join("\n");
    truncated = true;
  }

  return { diff: next.trimEnd(), truncated };
}

async function diffBuffersPreview(
  relativePath: string,
  before: Buffer,
  after: Buffer,
): Promise<{ diff: string; truncated: boolean; additions: number; deletions: number }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "anybot-diff-"));
  const beforePath = path.join(dir, "before");
  const afterPath = path.join(dir, "after");
  try {
    await Promise.all([
      fs.promises.writeFile(beforePath, before),
      fs.promises.writeFile(afterPath, after),
    ]);
    const raw = await runGitLimited(
      process.cwd(),
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "--numstat", "--patch", "--", beforePath, afterPath],
      PUBLIC_DIFF_MAX_BYTES + DIFF_NUMSTAT_HEADROOM_BYTES,
    );
    const patchStart = raw.stdout.search(/^diff --git /m);
    const counts = parseNumstatCounts(patchStart >= 0 ? raw.stdout.slice(0, patchStart) : raw.stdout);
    const normalized = (patchStart >= 0 ? raw.stdout.slice(patchStart) : "")
      .replace(/^diff --git .*$/m, `diff --git a/${relativePath} b/${relativePath}`)
      .replace(/^--- .*$/m, `--- a/${relativePath}`)
      .replace(/^\+\+\+ .*$/m, `+++ b/${relativePath}`)
      .trimEnd();
    return { ...truncateDiffPreview(normalized, raw.truncated), ...counts };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function getPublicReview(review: StoredChangeReviewSummary): PublicChangeReview {
  const visibleFiles = review.files.filter((file) => shouldReviewFile(review.workdir, file.path));
  const publicFiles = visibleFiles.map((file) => {
    const isBinary = hasBinaryDiffExtension(file.path) || file.diffType === "binary";
    const preview = isBinary
      ? { diff: "", truncated: false }
      : truncateDiffPreview(file.diff, !!file.diffTruncated);
    return {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      diff: preview.diff,
      diffType: isBinary ? "binary" as const : file.diffType || inferDiffTypeFromDiff(file.diff),
      diffTruncated: preview.truncated || undefined,
      fullDiffAvailable: preview.truncated || undefined,
    };
  });
  return {
    id: review.id,
    status: review.status,
    fileCount: publicFiles.length,
    totalAdditions: publicFiles.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: publicFiles.reduce((sum, file) => sum + file.deletions, 0),
    files: publicFiles,
    error: review.error,
  };
}

function reviewPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("变更审查 ID 无效");
  return path.join(reviewDir, `${id}.json`);
}

async function saveReview(review: StoredChangeReview): Promise<void> {
  await ensureReviewDir();
  review.updatedAt = Date.now();
  const summary = toChangeReviewSummary(review);
  await writeChangeReviewPayload(review.id, toChangeReviewPayload(review));
  await writeChangeReviewSummary(summary);
  await fs.promises.rm(reviewPath(review.id), { force: true });
}

/** 只重写审核摘要；修改前后的完整内容创建后不再变化，状态或错误变更无需重写 payload */
async function saveReviewSummary(review: StoredChangeReviewSummary): Promise<void> {
  review.updatedAt = Date.now();
  await writeChangeReviewSummary(toChangeReviewSummary(review));
}

async function loadStoredReview(id: string): Promise<StoredChangeReview | null> {
  const summary = await loadChangeReviewSummary(id);
  if (!summary) return null;
  const payload = await readChangeReviewPayload(id);
  if (!payload) return null;
  return mergeChangeReviewContent(summary, payload);
}

export async function createChangeSnapshot(workdir: string): Promise<ChangeSnapshot | null> {
  try {
    const inside = (await runGit(workdir, ["rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") return createFilesystemSnapshot(workdir);

    const trackedAtStart = new Set(splitNul(await runGit(workdir, ["ls-files", "-z"])));
    const changedPaths = parsePorcelainPaths(
      await runGit(workdir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ).filter((filePath) => shouldReviewFile(workdir, filePath));
    if (changedPaths.length > MAX_SNAPSHOT_ENTRIES) {
      logger.warn("change_review.snapshot_degraded", {
        workdir,
        reason: "too_many_changed_files",
        count: changedPaths.length,
        limit: MAX_SNAPSHOT_ENTRIES,
      });
      return createHintedSnapshot(workdir);
    }

    const changedSizes = await mapWithConcurrency(changedPaths, SNAPSHOT_IO_CONCURRENCY, async (filePath) => ({
      path: filePath,
      size: (await statReviewableFile(workdir, filePath))?.size ?? 0,
    }));
    const captured = await captureSnapshotContents(workdir, changedSizes);
    const snapshot = {
      workdir,
      mode: "git",
      trackedAtStart,
      changedAtStart: captured.files,
      filesAtStart: new Map(),
      statsAtStart: new Map(),
      uncapturedAtStart: captured.uncaptured,
    } satisfies ChangeSnapshot;
    await addPathsToChangeSnapshot(snapshot, ALWAYS_SNAPSHOT_FILES);
    return snapshot;
  } catch {
    return createFilesystemSnapshot(workdir);
  }
}

export async function collectChangeReview(
  snapshot: ChangeSnapshot | null,
): Promise<PublicChangeReview | null> {
  if (!snapshot) return null;

  const candidates = new Set<string>(snapshot.changedAtStart.keys());
  if (snapshot.mode === "git") {
    const afterPaths = parsePorcelainPaths(
      await runGit(snapshot.workdir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    );
    for (const filePath of afterPaths) candidates.add(filePath);
  } else if (snapshot.mode === "filesystem") {
    const { stats: afterStats } = await walkWorkspaceFiles(snapshot.workdir);
    for (const [filePath, stat] of afterStats) {
      const startStat = snapshot.statsAtStart.get(filePath);
      if (!startStat || !isSameFileStat(startStat, stat)) candidates.add(filePath);
    }
    for (const filePath of snapshot.statsAtStart.keys()) {
      if (!afterStats.has(filePath)) candidates.add(filePath);
    }
  }

  const reviewPaths = Array.from(candidates)
    .filter((filePath) => shouldReviewFile(snapshot.workdir, filePath))
    .sort();
  const files = (
    await mapWithConcurrency(reviewPaths, REVIEW_DIFF_CONCURRENCY, (filePath) =>
      buildStoredFileChange(snapshot, filePath),
    )
  ).filter((file): file is StoredFileChange => file !== null);

  if (files.length === 0) return null;

  const review: StoredChangeReview = {
    id: randomUUID(),
    workdir: snapshot.workdir,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileCount: files.length,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };

  await saveReview(review);
  return getPublicReview(review);
}

export async function getChangeReview(id: string): Promise<PublicChangeReview | null> {
  const review = await loadChangeReviewSummary(id);
  if (!review) return null;
  const publicReview = getPublicReview(review);
  return publicReview.files.length > 0 ? publicReview : null;
}

export async function getChangeReviewFileDiff(
  id: string,
  filePath: string,
): Promise<PublicFileChange | null> {
  const review = await loadStoredReview(id);
  if (!review) return null;

  const file = review.files.find((item) => item.path === filePath);
  if (!file || !shouldReviewFile(review.workdir, file.path)) return null;

  const isBinary = hasBinaryDiffExtension(file.path) || file.diffType === "binary";
  if (isBinary) {
    return {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      diff: "",
      diffType: "binary",
    };
  }

  const beforeBuffer = file.beforeContentBase64 ? decodeBase64(file.beforeContentBase64) : Buffer.alloc(0);
  const afterBuffer = file.afterContentBase64 ? decodeBase64(file.afterContentBase64) : Buffer.alloc(0);
  const diff = await diffBuffers(file.path, beforeBuffer, afterBuffer);
  const diffType = inferDiffTypeFromDiff(diff);

  return {
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    diff: diffType === "binary" ? "" : diff,
    diffType,
  };
}

export async function approveChangeReview(id: string): Promise<PublicChangeReview> {
  // 通过只改状态，读写摘要即可，不加载完整内容
  const review = await loadChangeReviewSummary(id);
  if (!review) throw new Error("变更审查不存在");
  if (review.status === "pending") {
    review.status = "approved";
    delete review.error;
    await saveReviewSummary(review);
  }
  return getPublicReview(review);
}

export async function revertChangeReview(id: string): Promise<PublicChangeReview> {
  const review = await loadStoredReview(id);
  if (!review) throw new Error("变更审查不存在");
  if (review.status !== "pending") return getPublicReview(review);

  const root = path.resolve(review.workdir);
  for (const file of review.files) {
    if (!shouldReviewFile(review.workdir, file.path)) continue;

    const absolutePath = path.resolve(root, file.path);
    if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
      review.error = `无法安全撤销：文件路径越界 ${file.path}`;
      await saveReviewSummary(review);
      return getPublicReview(review);
    }

    let current: Buffer | null = null;
    try {
      current = await fs.promises.readFile(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (!bufferEqualsBase64(current, file.afterContentBase64)) {
      review.error = `无法安全撤销：${file.path} 已被后续修改，请先手动处理该文件。`;
      await saveReviewSummary(review);
      return getPublicReview(review);
    }
  }

  for (const file of review.files) {
    if (!shouldReviewFile(review.workdir, file.path)) continue;

    const absolutePath = path.resolve(root, file.path);
    if (file.beforeContentBase64 === null) {
      await fs.promises.rm(absolutePath, { force: true });
      continue;
    }

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, Buffer.from(file.beforeContentBase64, "base64"));
  }

  review.status = "reverted";
  delete review.error;
  await saveReviewSummary(review);
  return getPublicReview(review);
}

/** 按并发上限处理列表，结果顺序与输入一致 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 从 fs.Stats 中提取判断文件是否改动所需的元信息 */
function toSnapshotFileStat(stat: fs.Stats): SnapshotFileStat {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

/** 判断两次记录的文件元信息是否一致 */
function isSameFileStat(a: SnapshotFileStat, b: SnapshotFileStat): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** 读取文件当前元信息；不存在、不是普通文件或超过单文件上限时返回 null */
async function statReviewableFile(workdir: string, relativePath: string): Promise<SnapshotFileStat | null> {
  const stat = await fs.promises.stat(path.resolve(workdir, relativePath)).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > MAX_SNAPSHOT_FILE_BYTES) return null;
  return toSnapshotFileStat(stat);
}

/** 在总字节预算内按文件从小到大读取快照内容，超出预算或读取失败的路径记入 uncaptured */
async function captureSnapshotContents(
  workdir: string,
  candidates: Array<{ path: string; size: number }>,
): Promise<{ files: Map<string, SnapshotFile>; uncaptured: Set<string> }> {
  const files = new Map<string, SnapshotFile>();
  const uncaptured = new Set<string>();
  const selected: string[] = [];
  let totalBytes = 0;

  for (const candidate of [...candidates].sort((a, b) => a.size - b.size)) {
    if (totalBytes + candidate.size > MAX_SNAPSHOT_TOTAL_BYTES) {
      uncaptured.add(candidate.path);
      continue;
    }
    totalBytes += candidate.size;
    selected.push(candidate.path);
  }

  await mapWithConcurrency(selected, SNAPSHOT_IO_CONCURRENCY, async (filePath) => {
    const fileSnapshot = await readReviewableFileSnapshot(workdir, filePath);
    if (fileSnapshot) files.set(filePath, fileSnapshot);
    else uncaptured.add(filePath);
  });
  return { files, uncaptured };
}

/** 创建只跟踪工具声明文件的降级快照，用于工作区过大无法全量比对的场景 */
async function createHintedSnapshot(workdir: string): Promise<ChangeSnapshot> {
  const snapshot: ChangeSnapshot = {
    workdir,
    mode: "hinted",
    trackedAtStart: new Set(),
    changedAtStart: new Map(),
    filesAtStart: new Map(),
    statsAtStart: new Map(),
    uncapturedAtStart: new Set(),
  };
  await addPathsToChangeSnapshot(snapshot, ALWAYS_SNAPSHOT_FILES);
  return snapshot;
}

/** 判断开始与结束快照的存在状态和内容是否一致 */
function isSameSnapshotContent(before: SnapshotFile, after: SnapshotFile): boolean {
  if (before.exists !== after.exists) return false;
  if (!before.content || !after.content) return before.content === after.content;
  return before.content.equals(after.content);
}

/** 解析 git diff --numstat 输出的新增/删除行数，二进制或无法解析时返回 0 */
function parseNumstatCounts(output: string): { additions: number; deletions: number } {
  const line = output.split("\n").find(Boolean) || "";
  const match = /^(\d+|-)\s+(\d+|-)\s+/.exec(line);
  if (!match || match[1] === "-" || match[2] === "-") return { additions: 0, deletions: 0 };
  return {
    additions: Number(match[1]) || 0,
    deletions: Number(match[2]) || 0,
  };
}

/** 比对单个候选文件的开始与结束内容并生成审查记录；无变化或缺少可靠基线时返回 null */
async function buildStoredFileChange(
  snapshot: ChangeSnapshot,
  filePath: string,
): Promise<StoredFileChange | null> {
  let beforeSnapshot =
    snapshot.filesAtStart.get(filePath) || snapshot.changedAtStart.get(filePath) || null;
  if (!beforeSnapshot && snapshot.uncapturedAtStart.has(filePath)) return null;
  if (!beforeSnapshot && snapshot.trackedAtStart.has(filePath)) {
    try {
      const content = await runGitBuffer(snapshot.workdir, ["show", `HEAD:${filePath}`]);
      if (content.length > MAX_SNAPSHOT_FILE_BYTES) return null;
      beforeSnapshot = { exists: true, content };
    } catch {
      return null;
    }
  }
  beforeSnapshot ||= { exists: false, content: null };

  if (beforeSnapshot.stat) {
    const currentStat = await statReviewableFile(snapshot.workdir, filePath);
    if (currentStat && isSameFileStat(beforeSnapshot.stat, currentStat)) return null;
  }

  const afterSnapshot = await readReviewableFileSnapshot(snapshot.workdir, filePath);
  if (!afterSnapshot) return null;
  if (isSameSnapshotContent(beforeSnapshot, afterSnapshot)) return null;

  const beforeForDiff = beforeSnapshot.content || Buffer.alloc(0);
  const afterForDiff = afterSnapshot.content || Buffer.alloc(0);
  let diffType = detectDiffType(filePath, beforeForDiff, afterForDiff);
  const preview = diffType === "text"
    ? await diffBuffersPreview(filePath, beforeForDiff, afterForDiff)
    : { diff: "", truncated: false, additions: 0, deletions: 0 };
  let diff = preview.diff;
  if (diffType === "text" && inferDiffTypeFromDiff(diff) === "binary") {
    diffType = "binary";
    diff = "";
  }
  const counts = diffType === "text"
    ? { additions: preview.additions, deletions: preview.deletions }
    : countDiffLines(diff);

  return {
    path: filePath,
    status: beforeSnapshot.exists ? (afterSnapshot.exists ? "modified" : "deleted") : "added",
    additions: counts.additions,
    deletions: counts.deletions,
    diff,
    diffType,
    diffTruncated: preview.truncated || undefined,
    fullDiffAvailable: preview.truncated || undefined,
    beforeContentBase64: beforeSnapshot.exists && beforeSnapshot.content
      ? beforeSnapshot.content.toString("base64")
      : null,
    afterContentBase64: afterSnapshot.exists && afterSnapshot.content
      ? afterSnapshot.content.toString("base64")
      : null,
  };
}

/** 校验变更审核 ID，避免路径拼出审核目录之外 */
function changeReviewFilePath(id: string, suffix: ".json" | ".summary.json" | ".payload.json"): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("变更审查 ID 无效");
  return path.join(reviewDir, `${id}${suffix}`);
}

function summaryPath(id: string): string {
  return changeReviewFilePath(id, ".summary.json");
}

function payloadPath(id: string): string {
  return changeReviewFilePath(id, ".payload.json");
}

/** 去掉完整内容，留下打开会话需要的摘要 */
function toChangeReviewSummary(review: StoredChangeReviewSummary): StoredChangeReviewSummary {
  return {
    ...review,
    files: review.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      diff: file.diff,
      diffType: file.diffType,
      diffTruncated: file.diffTruncated,
      fullDiffAvailable: file.fullDiffAvailable,
    })),
  };
}

/** 抽出修改前后的完整内容，单独落盘 */
function toChangeReviewPayload(review: StoredChangeReview): ChangeReviewContentPayload {
  return {
    files: review.files.map((file) => ({
      path: file.path,
      beforeContentBase64: file.beforeContentBase64,
      afterContentBase64: file.afterContentBase64,
    })),
  };
}

/** 把摘要和完整内容合并回撤销、查看 diff 使用的结构 */
function mergeChangeReviewContent(
  summary: StoredChangeReviewSummary,
  payload: ChangeReviewContentPayload,
): StoredChangeReview {
  const contentByPath = new Map(payload.files.map((file) => [file.path, file]));
  return {
    ...summary,
    files: summary.files.map((file) => {
      const content = contentByPath.get(file.path);
      return {
        ...file,
        beforeContentBase64: content?.beforeContentBase64 ?? null,
        afterContentBase64: content?.afterContentBase64 ?? null,
      };
    }),
  };
}

async function writeChangeReviewSummary(summary: StoredChangeReviewSummary): Promise<void> {
  await fs.promises.writeFile(summaryPath(summary.id), JSON.stringify(summary));
}

async function writeChangeReviewPayload(id: string, payload: ChangeReviewContentPayload): Promise<void> {
  await fs.promises.writeFile(payloadPath(id), JSON.stringify(payload));
}

async function readChangeReviewSummary(id: string): Promise<StoredChangeReviewSummary | null> {
  try {
    const raw = await fs.promises.readFile(summaryPath(id), "utf8");
    return JSON.parse(raw) as StoredChangeReviewSummary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readChangeReviewPayload(id: string): Promise<ChangeReviewContentPayload | null> {
  try {
    const raw = await fs.promises.readFile(payloadPath(id), "utf8");
    return JSON.parse(raw) as ChangeReviewContentPayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 读取审核摘要。旧的单文件会在第一次读到时拆成摘要和完整内容 */
async function loadChangeReviewSummary(id: string): Promise<StoredChangeReviewSummary | null> {
  const existing = await readChangeReviewSummary(id);
  if (existing) return existing;
  const migrated = await migrateLegacyChangeReview(id);
  if (migrated) return migrated;
  return readChangeReviewSummary(id);
}

/** 把旧版整文件拆开，之后打开会话只读摘要 */
async function migrateLegacyChangeReview(id: string): Promise<StoredChangeReviewSummary | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(reviewPath(id), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const stored = JSON.parse(raw) as StoredChangeReview;
  if (!stored || typeof stored !== "object" || !Array.isArray(stored.files)) return null;

  await writeChangeReviewPayload(id, toChangeReviewPayload(stored));
  const summary = toChangeReviewSummary(stored);
  await writeChangeReviewSummary(summary);
  await fs.promises.rm(reviewPath(id), { force: true });
  return summary;
}

/** 从消息 metadata 里收集变更审核 ID */
export function collectChangeReviewIdsFromMetadata(metadataList: readonly (string | null | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const raw of metadataList) {
    if (!raw || !raw.includes("\"changeReview\"")) continue;
    try {
      const parsed = JSON.parse(raw) as { changeReview?: { id?: unknown } };
      const id = parsed.changeReview?.id;
      if (typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)) ids.add(id);
    } catch {
      // 单条 metadata 损坏时跳过，不影响其余审核文件清理
    }
  }
  return [...ids];
}

/** 删除指定变更审核的摘要、完整内容和旧版单文件 */
export async function deleteChangeReviewFiles(ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map(async (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) return;
    try {
      await Promise.all([
        fs.promises.rm(summaryPath(id), { force: true }),
        fs.promises.rm(payloadPath(id), { force: true }),
        fs.promises.rm(changeReviewFilePath(id, ".json"), { force: true }),
      ]);
    } catch (error) {
      logger.warn("change_review.delete_failed", { id, error });
    }
  }));
}

/** 删除全部变更审核文件。调用前需要已经清空会话 */
export async function deleteAllChangeReviewFiles(): Promise<void> {
  try {
    await fs.promises.rm(reviewDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn("change_review.delete_all_failed", { error });
  }
}
