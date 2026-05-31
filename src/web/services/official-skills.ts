import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fetch as undiciFetch } from "undici";
import { logger } from "../../logger.js";
import { getClaudeSkillsDir } from "../../claude-config.js";
import { getCodexSkillsDir } from "../skills.js";

const DOWNLOAD_TIMEOUT_MS = 30000;
const SAFE_SKILL_DIR_RE = /^[A-Za-z0-9._-]+$/;

interface OfficialSkillSource {
  provider: "claude-code" | "codex";
  displayName: string;
  treeApiUrl: string;
  rawBaseUrl: string;
  skillTreeBaseUrl: string;
  skillsPrefix: string;
  folderNameIndex: number;
  targetDir: () => string;
}

const OFFICIAL_SKILL_SOURCES: Record<string, OfficialSkillSource> = {
  "claude-code": {
    provider: "claude-code",
    displayName: "Anthropic 官方技能包",
    treeApiUrl: "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1",
    rawBaseUrl: "https://raw.githubusercontent.com/anthropics/skills/main",
    skillTreeBaseUrl: "https://github.com/anthropics/skills/tree/main/skills",
    skillsPrefix: "skills/",
    folderNameIndex: 1,
    targetDir: getClaudeSkillsDir,
  },
  codex: {
    provider: "codex",
    displayName: "OpenAI 官方技能包",
    treeApiUrl: "https://api.github.com/repos/openai/skills/git/trees/main?recursive=1",
    rawBaseUrl: "https://raw.githubusercontent.com/openai/skills/main",
    skillTreeBaseUrl: "https://github.com/openai/skills/tree/main/skills/.curated",
    skillsPrefix: "skills/.curated/",
    folderNameIndex: 2,
    targetDir: getCodexSkillsDir,
  },
};

export interface OfficialSkillDownloadFailedItem {
  name: string;
  error: string;
}

export interface OfficialSkillDownloadEvent {
  phase: "discovering" | "downloading" | "completed" | "failed";
  message: string;
  percent: number | null;
  completed: number;
  total: number;
  targetDir: string;
  current?: string;
  installed: string[];
  reinstalled: string[];
  skipped: string[];
  failed: OfficialSkillDownloadFailedItem[];
}

export interface OfficialSkillListItem {
  name: string;
  url: string;
  installed: boolean;
  localStatus: "missing" | "directory" | "other";
}

export interface OfficialSkillListResult {
  sourceName: string;
  targetDir: string;
  skills: OfficialSkillListItem[];
}

interface GitTreeEntry {
  path: string;
  type: string;
}

interface RemoteSkillFile {
  repoPath: string;
  relativePath: string;
}

interface OfficialSkillDownloadState {
  phase: OfficialSkillDownloadEvent["phase"];
  message: string;
  percent: number | null;
  completed: number;
  total: number;
  targetDir: string;
  current?: string;
  installed: string[];
  reinstalled: string[];
  skipped: string[];
  failed: OfficialSkillDownloadFailedItem[];
}

type ProgressReporter = (event: OfficialSkillDownloadEvent) => void;
type FileDownloadProgressReporter = (file: RemoteSkillFile, fraction: number) => void;

interface DownloadOfficialSkillsOptions {
  skillNames?: string[];
  replaceExisting?: boolean;
}

function getOfficialSkillSource(providerType: string): OfficialSkillSource {
  const source = OFFICIAL_SKILL_SOURCES[providerType];
  if (!source) throw new Error("当前 Provider 不支持官方技能包");
  return source;
}

function makeUserAgent(): string {
  return `AnyBot/${process.env.npm_package_version || "dev"}`;
}

function emitProgress(state: OfficialSkillDownloadState, report: ProgressReporter): void {
  report({
    phase: state.phase,
    message: state.message,
    percent: state.percent,
    completed: state.completed,
    total: state.total,
    targetDir: state.targetDir,
    current: state.current,
    installed: [...state.installed],
    reinstalled: [...state.reinstalled],
    skipped: [...state.skipped],
    failed: [...state.failed],
  });
}

function updatePercent(state: OfficialSkillDownloadState, partialUnit = 0): void {
  state.percent = state.total > 0
    ? Math.max(0, Math.min(100, ((state.completed + partialUnit) / state.total) * 100))
    : null;
}

function isSafeSkillFolderName(name: string): boolean {
  return Boolean(name) && !name.startsWith(".") && SAFE_SKILL_DIR_RE.test(name);
}

function isSafeRelativePath(relativePath: string): boolean {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) return false;
  return relativePath
    .split("/")
    .every((part) => part && part !== "." && part !== ".." && !part.includes("\\") && !part.includes("\0"));
}

function ensureInsideDir(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error("目标路径不在技能目录内");
}

function rawFileUrl(source: OfficialSkillSource, repoPath: string): string {
  return `${source.rawBaseUrl}/${repoPath.split("/").map(encodeURIComponent).join("/")}`;
}

function parseGitTreeEntries(payload: unknown): GitTreeEntry[] {
  if (!payload || typeof payload !== "object" || !("tree" in payload)) return [];
  const tree = (payload as { tree?: unknown }).tree;
  if (!Array.isArray(tree)) return [];
  return tree
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const pathValue = (entry as { path?: unknown }).path;
      const typeValue = (entry as { type?: unknown }).type;
      if (typeof pathValue !== "string" || typeof typeValue !== "string") return null;
      return { path: pathValue, type: typeValue };
    })
    .filter((entry): entry is GitTreeEntry => Boolean(entry));
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    return await undiciFetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": makeUserAgent(),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGitTree(source: OfficialSkillSource): Promise<GitTreeEntry[]> {
  const response = await fetchWithTimeout(source.treeApiUrl);
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message?: unknown }).message || "")
      : "";
    throw new Error(message || `GitHub 返回 ${response.status}`);
  }
  return parseGitTreeEntries(payload);
}

function collectRemoteSkillFiles(entries: GitTreeEntry[], source: OfficialSkillSource): Map<string, RemoteSkillFile[]> {
  const skills = new Map<string, RemoteSkillFile[]>();
  for (const entry of entries) {
    if (entry.type !== "blob" || !entry.path.startsWith(source.skillsPrefix)) continue;
    const parts = entry.path.split("/");
    if (parts.length <= source.folderNameIndex + 1) continue;
    const folderName = parts[source.folderNameIndex];
    const relativePath = parts.slice(source.folderNameIndex + 1).join("/");
    if (!isSafeSkillFolderName(folderName) || !isSafeRelativePath(relativePath)) continue;
    const files = skills.get(folderName) || [];
    files.push({ repoPath: entry.path, relativePath });
    skills.set(folderName, files);
  }

  for (const [folderName, files] of skills) {
    if (!files.some((file) => file.relativePath === "SKILL.md")) {
      skills.delete(folderName);
    }
  }

  return new Map([...skills.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function downloadRemoteFile(
  source: OfficialSkillSource,
  file: RemoteSkillFile,
  targetDir: string,
  onProgress?: FileDownloadProgressReporter,
): Promise<void> {
  const targetPath = path.resolve(targetDir, file.relativePath);
  ensureInsideDir(targetDir, targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const response = await fetchWithTimeout(rawFileUrl(source, file.repoPath));
  if (!response.ok) {
    throw new Error(`${file.relativePath} 下载失败：${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (response.body && Number.isFinite(contentLength) && contentLength > 0) {
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bufferChunk = Buffer.from(chunk.value);
      chunks.push(bufferChunk);
      received += bufferChunk.length;
      onProgress?.(file, Math.max(0, Math.min(0.98, received / contentLength)));
    }
    fs.writeFileSync(targetPath, Buffer.concat(chunks));
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);
  }
  onProgress?.(file, 1);
}

async function downloadSkillToTemp(
  source: OfficialSkillSource,
  folderName: string,
  files: RemoteSkillFile[],
  tempRoot: string,
  onProgress?: FileDownloadProgressReporter,
): Promise<string> {
  const tempSkillDir = path.join(tempRoot, folderName);
  fs.mkdirSync(tempSkillDir, { recursive: true });
  for (const file of files) {
    await downloadRemoteFile(source, file, tempSkillDir, onProgress);
  }
  return tempSkillDir;
}

function createStagingSkill(tempSkillDir: string, targetSkillDir: string): string {
  const parentDir = path.dirname(targetSkillDir);
  const stagingDir = path.join(parentDir, `.${path.basename(targetSkillDir)}.anybot-${randomUUID()}`);
  ensureInsideDir(parentDir, stagingDir);
  try {
    fs.cpSync(tempSkillDir, stagingDir, { recursive: true, force: false, errorOnExist: true });
    return stagingDir;
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function installTempSkill(tempSkillDir: string, targetSkillDir: string): void {
  const stagingDir = createStagingSkill(tempSkillDir, targetSkillDir);
  try {
    fs.renameSync(stagingDir, targetSkillDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function replaceTempSkill(tempSkillDir: string, targetSkillDir: string): void {
  const stagingDir = createStagingSkill(tempSkillDir, targetSkillDir);
  try {
    fs.rmSync(targetSkillDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, targetSkillDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function getLocalSkillStatus(targetDir: string, folderName: string): "missing" | "directory" | "other" {
  const targetSkillDir = path.resolve(targetDir, folderName);
  ensureInsideDir(targetDir, targetSkillDir);
  if (!fs.existsSync(targetSkillDir)) return "missing";
  try {
    return fs.statSync(targetSkillDir).isDirectory() ? "directory" : "other";
  } catch {
    return "other";
  }
}

function normalizeRequestedSkillNames(skillNames: string[] | undefined, remoteSkills: Map<string, RemoteSkillFile[]>): string[] {
  const requested = skillNames && skillNames.length > 0 ? skillNames : [...remoteSkills.keys()];
  return Array.from(new Set(requested.map((name) => name.trim()).filter(Boolean)));
}

function getSkillDownloadUnitCount(files: RemoteSkillFile[] | undefined): number {
  return files && files.length > 0 ? files.length + 1 : 1;
}

function countDownloadUnits(skillNames: string[], remoteSkills: Map<string, RemoteSkillFile[]>): number {
  return skillNames.reduce((total, folderName) => total + getSkillDownloadUnitCount(remoteSkills.get(folderName)), 0);
}

function completeRemainingSkillUnits(
  state: OfficialSkillDownloadState,
  skillStartCompleted: number,
  skillUnitCount: number,
): void {
  state.completed = Math.max(state.completed, skillStartCompleted + skillUnitCount);
  updatePercent(state);
}

export async function listOfficialSkills(providerType: string): Promise<OfficialSkillListResult> {
  const source = getOfficialSkillSource(providerType);
  const targetDir = source.targetDir();
  const remoteSkills = collectRemoteSkillFiles(await fetchGitTree(source), source);
  const statusRank = { missing: 0, directory: 1, other: 2 } as const;
  const skills = [...remoteSkills.keys()].map((name) => {
    const localStatus = getLocalSkillStatus(targetDir, name);
    return {
      name,
      url: `${source.skillTreeBaseUrl}/${encodeURIComponent(name)}`,
      installed: localStatus === "directory",
      localStatus,
    };
  });
  skills.sort((left, right) => {
    const leftRank = statusRank[left.localStatus];
    const rightRank = statusRank[right.localStatus];
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name.localeCompare(right.name);
  });
  return {
    sourceName: source.displayName,
    targetDir,
    skills,
  };
}

export async function downloadOfficialSkills(
  providerType: string,
  report: ProgressReporter,
  opts: DownloadOfficialSkillsOptions = {},
): Promise<OfficialSkillDownloadEvent> {
  const source = getOfficialSkillSource(providerType);
  const targetDir = source.targetDir();
  const state: OfficialSkillDownloadState = {
    phase: "discovering",
    message: `正在读取 ${source.displayName}...`,
    percent: null,
    completed: 0,
    total: 0,
    targetDir,
    installed: [],
    reinstalled: [],
    skipped: [],
    failed: [],
  };

  emitProgress(state, report);

  const entries = await fetchGitTree(source);
  const remoteSkills = collectRemoteSkillFiles(entries, source);
  if (remoteSkills.size === 0) {
    throw new Error("未找到可下载的官方技能");
  }

  const skillNames = normalizeRequestedSkillNames(opts.skillNames, remoteSkills);
  fs.mkdirSync(targetDir, { recursive: true });
  state.phase = "downloading";
  state.total = countDownloadUnits(skillNames, remoteSkills);
  updatePercent(state);
  state.message = `准备处理 ${skillNames.length} 个官方技能...`;
  emitProgress(state, report);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `anybot-${source.provider}-official-skills-`));
  try {
    for (const folderName of skillNames) {
      const files = remoteSkills.get(folderName);
      const skillStartCompleted = state.completed;
      const skillUnitCount = getSkillDownloadUnitCount(files);
      state.current = folderName;
      state.message = `正在处理 ${folderName}...`;
      emitProgress(state, report);

      if (!isSafeSkillFolderName(folderName)) {
        state.failed.push({ name: folderName, error: "技能文件夹名不合法" });
        completeRemainingSkillUnits(state, skillStartCompleted, skillUnitCount);
        emitProgress(state, report);
        continue;
      }

      if (!files) {
        state.failed.push({ name: folderName, error: "官方技能不存在" });
        completeRemainingSkillUnits(state, skillStartCompleted, skillUnitCount);
        emitProgress(state, report);
        continue;
      }

      const targetSkillDir = path.resolve(targetDir, folderName);
      ensureInsideDir(targetDir, targetSkillDir);
      if (fs.existsSync(targetSkillDir)) {
        try {
          if (!fs.statSync(targetSkillDir).isDirectory()) {
            state.failed.push({ name: folderName, error: "同名路径已存在但不是文件夹" });
            completeRemainingSkillUnits(state, skillStartCompleted, skillUnitCount);
            emitProgress(state, report);
            continue;
          }
          if (!opts.replaceExisting) {
            state.skipped.push(folderName);
            completeRemainingSkillUnits(state, skillStartCompleted, skillUnitCount);
            emitProgress(state, report);
            continue;
          }
        } catch (error) {
          state.failed.push({ name: folderName, error: error instanceof Error ? error.message : "读取本地路径失败" });
          completeRemainingSkillUnits(state, skillStartCompleted, skillUnitCount);
          emitProgress(state, report);
          continue;
        }
      }

      try {
        let lastReportedPercent = typeof state.percent === "number" ? state.percent : -1;
        const tempSkillDir = await downloadSkillToTemp(source, folderName, files, tempRoot, (file, fraction) => {
          const safeFraction = Math.max(0, Math.min(1, fraction));
          state.current = `${folderName}/${file.relativePath}`;
          state.message = `正在下载 ${state.current}...`;
          if (safeFraction >= 1) {
            state.completed += 1;
            updatePercent(state);
          } else {
            updatePercent(state, safeFraction);
          }
          if (state.percent !== null && (state.percent - lastReportedPercent >= 1 || safeFraction >= 1)) {
            lastReportedPercent = state.percent;
            emitProgress(state, report);
          }
        });
        state.current = folderName;
        const finalLocalStatus = getLocalSkillStatus(targetDir, folderName);
        if (finalLocalStatus === "directory" && opts.replaceExisting) {
          replaceTempSkill(tempSkillDir, targetSkillDir);
          state.reinstalled.push(folderName);
        } else if (finalLocalStatus === "directory") {
          state.skipped.push(folderName);
        } else if (finalLocalStatus === "other") {
          state.failed.push({ name: folderName, error: "同名路径已存在但不是文件夹" });
        } else {
          installTempSkill(tempSkillDir, targetSkillDir);
          state.installed.push(folderName);
        }
        state.completed += 1;
        updatePercent(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "下载失败";
        logger.warn("official_skills.download_skill_failed", { skill: folderName, error: message });
        state.failed.push({ name: folderName, error: message });
        completeRemainingSkillUnits(state, skillStartCompleted, skillUnitCount);
      }

      emitProgress(state, report);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  state.phase = state.failed.length > 0 ? "failed" : "completed";
  state.current = undefined;
  state.percent = 100;
  state.message = state.failed.length > 0
    ? `技能下载完成，${state.failed.length} 个技能失败。`
    : "技能下载完成，已放到对应位置。";
  emitProgress(state, report);
  return {
    phase: state.phase,
    message: state.message,
    percent: state.percent,
    completed: state.completed,
    total: state.total,
    targetDir: state.targetDir,
    installed: [...state.installed],
    reinstalled: [...state.reinstalled],
    skipped: [...state.skipped],
    failed: [...state.failed],
  };
}
