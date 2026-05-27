import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fetch as undiciFetch } from "undici";
import { logger } from "../../logger.js";
import { getClaudeSkillsDir } from "../skills.js";

const GITHUB_TREE_API_URL = "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1";
const GITHUB_RAW_BASE_URL = "https://raw.githubusercontent.com/anthropics/skills/main";
const GITHUB_SKILL_TREE_BASE_URL = "https://github.com/anthropics/skills/tree/main/skills";
const OFFICIAL_SKILLS_PREFIX = "skills/";
const DOWNLOAD_TIMEOUT_MS = 30000;
const SAFE_SKILL_DIR_RE = /^[A-Za-z0-9._-]+$/;

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

interface DownloadOfficialClaudeSkillsOptions {
  skillNames?: string[];
  replaceExisting?: boolean;
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

function updatePercent(state: OfficialSkillDownloadState): void {
  state.percent = state.total > 0
    ? Math.max(0, Math.min(100, (state.completed / state.total) * 100))
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

function rawFileUrl(repoPath: string): string {
  return `${GITHUB_RAW_BASE_URL}/${repoPath.split("/").map(encodeURIComponent).join("/")}`;
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

async function fetchGitTree(): Promise<GitTreeEntry[]> {
  const response = await fetchWithTimeout(GITHUB_TREE_API_URL);
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

function collectRemoteSkillFiles(entries: GitTreeEntry[]): Map<string, RemoteSkillFile[]> {
  const skills = new Map<string, RemoteSkillFile[]>();
  for (const entry of entries) {
    if (entry.type !== "blob" || !entry.path.startsWith(OFFICIAL_SKILLS_PREFIX)) continue;
    const parts = entry.path.split("/");
    if (parts.length < 3) continue;
    const folderName = parts[1];
    const relativePath = parts.slice(2).join("/");
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

async function downloadRemoteFile(file: RemoteSkillFile, targetDir: string): Promise<void> {
  const targetPath = path.resolve(targetDir, file.relativePath);
  ensureInsideDir(targetDir, targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const response = await fetchWithTimeout(rawFileUrl(file.repoPath));
  if (!response.ok) {
    throw new Error(`${file.relativePath} 下载失败：${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, buffer);
}

async function downloadSkillToTemp(folderName: string, files: RemoteSkillFile[], tempRoot: string): Promise<string> {
  const tempSkillDir = path.join(tempRoot, folderName);
  fs.mkdirSync(tempSkillDir, { recursive: true });
  for (const file of files) {
    await downloadRemoteFile(file, tempSkillDir);
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

export async function listOfficialClaudeSkills(): Promise<OfficialSkillListResult> {
  const targetDir = getClaudeSkillsDir();
  const remoteSkills = collectRemoteSkillFiles(await fetchGitTree());
  const statusRank = { missing: 0, directory: 1, other: 2 } as const;
  const skills = [...remoteSkills.keys()].map((name) => {
    const localStatus = getLocalSkillStatus(targetDir, name);
      return {
        name,
        url: `${GITHUB_SKILL_TREE_BASE_URL}/${encodeURIComponent(name)}`,
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
    targetDir,
    skills,
  };
}

export async function downloadOfficialClaudeSkills(
  report: ProgressReporter,
  opts: DownloadOfficialClaudeSkillsOptions = {},
): Promise<OfficialSkillDownloadEvent> {
  const targetDir = getClaudeSkillsDir();
  const state: OfficialSkillDownloadState = {
    phase: "discovering",
    message: "正在读取 Anthropic 官方技能包...",
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

  const entries = await fetchGitTree();
  const remoteSkills = collectRemoteSkillFiles(entries);
  if (remoteSkills.size === 0) {
    throw new Error("未找到可下载的官方技能");
  }

  const skillNames = normalizeRequestedSkillNames(opts.skillNames, remoteSkills);
  fs.mkdirSync(targetDir, { recursive: true });
  state.phase = "downloading";
  state.total = skillNames.length;
  updatePercent(state);
  state.message = `准备处理 ${state.total} 个官方技能...`;
  emitProgress(state, report);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "anybot-official-skills-"));
  try {
    for (const folderName of skillNames) {
      state.current = folderName;
      state.message = `正在处理 ${folderName}...`;
      emitProgress(state, report);

      if (!isSafeSkillFolderName(folderName)) {
        state.failed.push({ name: folderName, error: "技能文件夹名不合法" });
        state.completed += 1;
        updatePercent(state);
        emitProgress(state, report);
        continue;
      }

      const files = remoteSkills.get(folderName);
      if (!files) {
        state.failed.push({ name: folderName, error: "官方技能不存在" });
        state.completed += 1;
        updatePercent(state);
        emitProgress(state, report);
        continue;
      }

      const targetSkillDir = path.resolve(targetDir, folderName);
      ensureInsideDir(targetDir, targetSkillDir);
      if (fs.existsSync(targetSkillDir)) {
        try {
          if (!fs.statSync(targetSkillDir).isDirectory()) {
            state.failed.push({ name: folderName, error: "同名路径已存在但不是文件夹" });
            state.completed += 1;
            updatePercent(state);
            emitProgress(state, report);
            continue;
          }
          if (!opts.replaceExisting) {
            state.skipped.push(folderName);
            state.completed += 1;
            updatePercent(state);
            emitProgress(state, report);
            continue;
          }
        } catch (error) {
          state.failed.push({ name: folderName, error: error instanceof Error ? error.message : "读取本地路径失败" });
          state.completed += 1;
          updatePercent(state);
          emitProgress(state, report);
          continue;
        }
      }

      try {
        const tempSkillDir = await downloadSkillToTemp(folderName, files, tempRoot);
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
      } catch (error) {
        const message = error instanceof Error ? error.message : "下载失败";
        logger.warn("official_skills.download_skill_failed", { skill: folderName, error: message });
        state.failed.push({ name: folderName, error: message });
      }

      state.completed += 1;
      updatePercent(state);
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
