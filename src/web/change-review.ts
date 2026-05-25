import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { hasBinaryDiffFileType, shouldSuppressDiffFile } from "../diff-file-types.js";

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

type SnapshotFile = {
  exists: boolean;
  contentBase64: string | null;
};

export type ChangeSnapshot = {
  workdir: string;
  mode: "git" | "filesystem";
  trackedAtStart: Set<string>;
  changedAtStart: Map<string, SnapshotFile>;
  filesAtStart: Map<string, SnapshotFile>;
};

const dataDir =
  process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.join(process.cwd(), ".data");
const reviewDir = path.join(dataDir, "change-reviews");
const SNAPSHOT_SKIP_DIRS = new Set([".git", "node_modules", ".data", ".run", "tmp"]);
const ALWAYS_SNAPSHOT_FILES = ["CLAUDE.md"];
const DESKTOP_USER_DATA_REVIEW_FILES = new Set([
  "agents.md",
  "bootstrap.md",
  "claude.md",
  "memory.md",
  "profile.md",
]);
const MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;

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
    return { exists: true, contentBase64: content.toString("base64") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, contentBase64: null };
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

async function walkWorkspaceFiles(workdir: string): Promise<string[]> {
  const root = path.resolve(workdir);
  const result: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativeParts = path.relative(root, absolutePath).split(path.sep);
      if (entry.isDirectory()) {
        if (shouldSkipSnapshotPath(root, relativeParts)) continue;
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldSkipSnapshotPath(root, relativeParts)) continue;

      const stat = await fs.promises.stat(absolutePath).catch(() => null);
      if (!stat || stat.size > MAX_SNAPSHOT_FILE_BYTES) continue;
      result.push(path.relative(root, absolutePath));
    }
  }

  await walk(root);
  return result.sort();
}

async function createFilesystemSnapshot(workdir: string): Promise<ChangeSnapshot | null> {
  const filesAtStart = new Map<string, SnapshotFile>();
  for (const filePath of await walkWorkspaceFiles(workdir)) {
    const fileSnapshot = await readReviewableFileSnapshot(workdir, filePath);
    if (fileSnapshot) filesAtStart.set(filePath, fileSnapshot);
  }
  return {
    workdir,
    mode: "filesystem",
    trackedAtStart: new Set(),
    changedAtStart: new Map(),
    filesAtStart,
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

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function getPublicReview(review: StoredChangeReview): PublicChangeReview {
  const visibleFiles = review.files.filter((file) => shouldReviewFile(review.workdir, file.path));
  const publicFiles = visibleFiles.map((file) => {
    const isBinary = hasBinaryDiffExtension(file.path);
    return {
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      diff: isBinary ? "" : file.diff,
      diffType: isBinary ? "binary" as const : file.diffType || inferDiffTypeFromDiff(file.diff),
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
  await fs.promises.writeFile(reviewPath(review.id), JSON.stringify(review, null, 2));
}

async function loadStoredReview(id: string): Promise<StoredChangeReview | null> {
  try {
    const raw = await fs.promises.readFile(reviewPath(id), "utf8");
    return JSON.parse(raw) as StoredChangeReview;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function createChangeSnapshot(workdir: string): Promise<ChangeSnapshot | null> {
  try {
    const inside = (await runGit(workdir, ["rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") return createFilesystemSnapshot(workdir);

    const trackedAtStart = new Set(splitNul(await runGit(workdir, ["ls-files", "-z"])));
    const changedPaths = parsePorcelainPaths(
      await runGit(workdir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    );
    const changedAtStart = new Map<string, SnapshotFile>();

    for (const filePath of changedPaths) {
      const fileSnapshot = await readReviewableFileSnapshot(workdir, filePath);
      if (fileSnapshot) changedAtStart.set(filePath, fileSnapshot);
    }
    const snapshot = {
      workdir,
      mode: "git",
      trackedAtStart,
      changedAtStart,
      filesAtStart: new Map(),
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

  const afterFiles =
    snapshot.mode === "filesystem"
      ? new Map(
          (
            await Promise.all(
              (await walkWorkspaceFiles(snapshot.workdir)).map(async (filePath) => {
                const fileSnapshot = await readReviewableFileSnapshot(snapshot.workdir, filePath);
                return fileSnapshot ? ([filePath, fileSnapshot] as const) : null;
              }),
            )
          ).filter((entry): entry is readonly [string, SnapshotFile] => entry !== null),
        )
      : null;
  const afterPaths =
    snapshot.mode === "git"
      ? parsePorcelainPaths(
          await runGit(snapshot.workdir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        )
      : Array.from(afterFiles?.keys() || []);
  const candidates = new Set([
    ...afterPaths,
    ...snapshot.changedAtStart.keys(),
    ...snapshot.filesAtStart.keys(),
  ]);
  const files: StoredFileChange[] = [];

  for (const filePath of Array.from(candidates).sort()) {
    if (!shouldReviewFile(snapshot.workdir, filePath)) continue;

    let beforeSnapshot =
      snapshot.filesAtStart.get(filePath) || snapshot.changedAtStart.get(filePath) || null;
    if (!beforeSnapshot && snapshot.trackedAtStart.has(filePath)) {
      try {
        const content = await runGitBuffer(snapshot.workdir, ["show", `HEAD:${filePath}`]);
        if (content.length > MAX_SNAPSHOT_FILE_BYTES) continue;
        beforeSnapshot = { exists: true, contentBase64: content.toString("base64") };
      } catch {
        continue;
      }
    }
    beforeSnapshot ||= { exists: false, contentBase64: null };

    const afterSnapshot =
      afterFiles?.get(filePath) || (await readReviewableFileSnapshot(snapshot.workdir, filePath));
    if (!afterSnapshot) continue;

    const beforeBuffer = beforeSnapshot.exists ? decodeBase64(beforeSnapshot.contentBase64) : null;
    const afterBuffer = afterSnapshot.exists ? decodeBase64(afterSnapshot.contentBase64) : null;

    if (bufferEqualsBase64(afterBuffer, beforeSnapshot.contentBase64)) continue;

    const beforeForDiff = beforeBuffer || Buffer.alloc(0);
    const afterForDiff = afterBuffer || Buffer.alloc(0);
    let diffType = detectDiffType(filePath, beforeForDiff, afterForDiff);
    let diff = diffType === "text" ? await diffBuffers(filePath, beforeForDiff, afterForDiff) : "";
    if (diffType === "text" && inferDiffTypeFromDiff(diff) === "binary") {
      diffType = "binary";
      diff = "";
    }
    const counts = countDiffLines(diff);

    files.push({
      path: filePath,
      status: beforeSnapshot.exists ? (afterSnapshot.exists ? "modified" : "deleted") : "added",
      additions: counts.additions,
      deletions: counts.deletions,
      diff,
      diffType,
      beforeContentBase64: beforeSnapshot.exists ? beforeSnapshot.contentBase64 : null,
      afterContentBase64: afterSnapshot.exists ? afterSnapshot.contentBase64 : null,
    });
  }

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
  const review = await loadStoredReview(id);
  if (!review) return null;
  const publicReview = getPublicReview(review);
  return publicReview.files.length > 0 ? publicReview : null;
}

export async function approveChangeReview(id: string): Promise<PublicChangeReview> {
  const review = await loadStoredReview(id);
  if (!review) throw new Error("变更审查不存在");
  if (review.status === "pending") {
    review.status = "approved";
    delete review.error;
    await saveReview(review);
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
      await saveReview(review);
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
      await saveReview(review);
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
  await saveReview(review);
  return getPublicReview(review);
}
