import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { getProvider } from "../providers/index.js";
import { logger } from "../logger.js";
import { getLogDir } from "../logger.js";
import { getDataDir, readAppSettings, updateAppSettings, writeAppSettings, type AppSettings } from "../app-settings.js";
import { openDirectory } from "../utils/open-directory.js";
import * as db from "./db.js";
import {
  readModelConfig,
  readModelConfigForProvider,
  writeModelConfig,
  setCurrentModel,
  setModelForProvider,
  setCurrentProvider,
  getProviderTypes,
} from "./model-config.js";
import { readSandboxConfig, sandboxModeOptions, setDefaultSandbox } from "../sandbox-config.js";
import {
  readChannelsConfig,
  writeChannelsConfig,
  updateChannelConfig,
  getRegisteredChannelTypes,
  channelManager,
} from "../channels/index.js";
import { getWeixinLoginStatus } from "../channels/weixin.js";
import { listSkills, listSkillMentions, toggleSkill, deleteSkill, openSkillsFolder } from "./skills.js";
import { listWebSlashItems } from "./slash-items.js";
import { readProxyConfig, writeProxyConfig, getProxyUrl, type ProxyConfig } from "./proxy-config.js";
import { applyProxy, isProxyFeatureEnabled } from "../proxy.js";
import {
  approveChangeReview,
  getChangeReview,
  revertChangeReview,
} from "./change-review.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  generateId,
  getWorkdir,
} from "../shared.js";
import type { ClaudeAgentStreamEvent } from "../providers/claude-code-agent-events.js";
import {
  attachAgentStreamClient,
  compactAgentEvents,
  createActiveAgentStream,
  emitAgentStream,
  finishAgentStream,
  getActiveAgentStreamInfo,
  hasActiveAgentStream,
  type AgentStreamEvent,
} from "./agent-stream.js";
import {
  attachWebUiEventClient,
  emitHistoryCleared,
  emitProjectsChanged,
  emitSessionsChanged,
} from "./events.js";
import {
  ChatTurnValidationError,
  prepareChatTurn,
  runChatTurn,
  runPreparedChatTurn,
  type PreparedChatTurn,
} from "../chat-runner.js";

const execFile = promisify(execFileCallback);
const DEFAULT_SESSION_MESSAGE_LIMIT = 40;
const MESSAGE_PREVIEW_CHARS = 20000;
const WORKSPACE_MEMORY_FILES = ["AGENTS.md", "MEMORY.md", "PROFILE.md", "BOOTSTRAP.md"] as const;
const PROVIDER_MODEL_FETCH_TIMEOUT_MS = 10000;
const PROVIDER_MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/1935417243/AnyBot/releases/latest";
const GITHUB_LATEST_RELEASE_URL = "https://github.com/1935417243/AnyBot/releases/latest";
const activeRunControllers = new Map<string, AbortController>();
const providerModelCache = new Map<string, { expiresAt: number; models: string[]; provider: string }>();
let manualDesktopUpdateStatus: Record<string, unknown> | null = null;

function buildProviderModelsRequest(baseUrl: string): { modelsUrl: string; provider: string } {
  const parsed = new URL(baseUrl);
  const lower = baseUrl.toLowerCase();
  if (lower.includes("vibeapi")) {
    return { modelsUrl: new URL("/v1/models", parsed.origin).toString(), provider: "VibeAPI" };
  }
  if (lower.includes("api.deepseek.com")) {
    return { modelsUrl: new URL("/models", parsed.origin).toString(), provider: "DeepSeek" };
  }
  throw new Error("仅支持 VibeAPI 或 DeepSeek Base URL 自动获取模型");
}

function getProviderModelCacheKey(modelsUrl: string, apiKey: string): string {
  return createHash("sha256").update(modelsUrl).update("\0").update(apiKey).digest("hex");
}

function getObjectStringValue(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  if (raw && typeof raw === "object") return getObjectStringValue(raw, "message");
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function extractProviderModelIds(payload: unknown): string[] {
  const data = getObjectArrayValue(payload, "data");
  const models = getObjectArrayValue(payload, "models");
  const source = Array.isArray(payload) ? payload : data || models || [];
  const ids = source
    .map((item) => {
      if (typeof item === "string") return item.trim();
      return (
        getObjectStringValue(item, "id") ||
        getObjectStringValue(item, "name") ||
        getObjectStringValue(item, "model")
      );
    })
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}

function getObjectArrayValue(value: unknown, key: string): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getDesktopUpdateCurrentVersion(): string {
  return process.env.ANYBOT_DESKTOP_APP_VERSION || process.env.npm_package_version || "0.0.0";
}

function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = normalizeReleaseVersion(left).split(/[^\d]+/).filter(Boolean).map((part) => Number.parseInt(part, 10));
  const rightParts = normalizeReleaseVersion(right).split(/[^\d]+/).filter(Boolean).map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = Number.isFinite(leftParts[i]) ? leftParts[i] : 0;
    const rightPart = Number.isFinite(rightParts[i]) ? rightParts[i] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function normalizeManualDesktopUpdateStatus(payload: Record<string, unknown>): Record<string, unknown> {
  const state = typeof payload.state === "string" ? payload.state : "idle";
  const isBlockedState = state === "unsupported" || state === "unavailable";
  return {
    ...payload,
    platform: typeof payload.platform === "string" ? payload.platform : process.platform,
    supported: false,
    packaged: Boolean(payload.packaged),
    currentVersion: typeof payload.currentVersion === "string" ? payload.currentVersion : getDesktopUpdateCurrentVersion(),
    state: isBlockedState ? "idle" : state,
    message: isBlockedState ? "准备检查更新。" : (typeof payload.message === "string" ? payload.message : ""),
    latestVersion: typeof payload.latestVersion === "string" ? payload.latestVersion : null,
    updateInfo: payload.updateInfo && typeof payload.updateInfo === "object" ? payload.updateInfo : null,
    progress: null,
    error: typeof payload.error === "string" ? payload.error : null,
    checkedAt: typeof payload.checkedAt === "number" ? payload.checkedAt : null,
    releaseUrl: typeof payload.releaseUrl === "string" ? payload.releaseUrl : GITHUB_LATEST_RELEASE_URL,
    downloadUrl: typeof payload.downloadUrl === "string" ? payload.downloadUrl : GITHUB_LATEST_RELEASE_URL,
    manualDownload: true,
  };
}

function shouldUseManualReleaseCheck(payload: Record<string, unknown>): boolean {
  return payload.supported === false || payload.state === "unsupported" || payload.state === "unavailable";
}

function rememberManualDesktopUpdateStatus(status: Record<string, unknown>): Record<string, unknown> {
  manualDesktopUpdateStatus = normalizeManualDesktopUpdateStatus(status);
  return manualDesktopUpdateStatus;
}

function getManualDesktopUpdateStatus(baseStatus: Record<string, unknown>): Record<string, unknown> {
  const normalizedBase = normalizeManualDesktopUpdateStatus(baseStatus);
  if (!manualDesktopUpdateStatus) return normalizedBase;
  return normalizeManualDesktopUpdateStatus({
    ...normalizedBase,
    ...manualDesktopUpdateStatus,
    platform: normalizedBase.platform,
    packaged: normalizedBase.packaged,
    currentVersion: normalizedBase.currentVersion,
  });
}

async function checkLatestGitHubReleaseStatus(baseStatus: Record<string, unknown>): Promise<Record<string, unknown>> {
  const checkedAt = Date.now();
  const currentVersion = typeof baseStatus.currentVersion === "string"
    ? baseStatus.currentVersion
    : getDesktopUpdateCurrentVersion();
  const lastCheckedAt = typeof manualDesktopUpdateStatus?.checkedAt === "number"
    ? manualDesktopUpdateStatus.checkedAt
    : null;
  rememberManualDesktopUpdateStatus({
    ...baseStatus,
    state: "checking",
    message: "正在检查更新...",
    progress: null,
    error: null,
    checkedAt: lastCheckedAt,
  });

  try {
    const response = await undiciFetch(GITHUB_LATEST_RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `AnyBot/${currentVersion}`,
      },
    });
    const text = await response.text();
    const release = asRecord(text ? JSON.parse(text) : {});
    if (!response.ok) {
      throw new Error(getObjectStringValue(release, "message") || `GitHub Releases 返回 ${response.status}`);
    }

    const latestVersion = normalizeReleaseVersion(
      getObjectStringValue(release, "tag_name") || getObjectStringValue(release, "name") || "",
    );
    if (!latestVersion) {
      throw new Error("GitHub Release 未包含版本号");
    }

    const releaseUrl = getObjectStringValue(release, "html_url") || GITHUB_LATEST_RELEASE_URL;
    const hasNewVersion = compareVersionStrings(latestVersion, currentVersion) > 0;
    return rememberManualDesktopUpdateStatus({
      ...baseStatus,
      state: hasNewVersion ? "available" : "not-available",
      message: hasNewVersion ? `发现新版本 · ${latestVersion}` : "当前已是最新版本。",
      latestVersion,
      updateInfo: {
        version: latestVersion,
        releaseName: getObjectStringValue(release, "name"),
        releaseDate: getObjectStringValue(release, "published_at") || getObjectStringValue(release, "created_at"),
      },
      progress: null,
      error: null,
      checkedAt,
      releaseUrl,
      downloadUrl: releaseUrl,
    });
  } catch (error) {
    return rememberManualDesktopUpdateStatus({
      ...baseStatus,
      state: "error",
      message: "检查更新失败。",
      progress: null,
      error: error instanceof Error ? error.message : String(error),
      checkedAt,
    });
  }
}

function getDesktopUpdateUnavailableStatus(): Record<string, unknown> {
  return normalizeManualDesktopUpdateStatus({
    platform: process.platform,
    supported: false,
    packaged: false,
    currentVersion: getDesktopUpdateCurrentVersion(),
    state: "idle",
    message: "准备检查更新。",
    latestVersion: null,
    updateInfo: null,
    progress: null,
    error: null,
    checkedAt: null,
  });
}

async function proxyDesktopUpdate(
  endpoint: "/status" | "/check" | "/download" | "/restart",
  method: "GET" | "POST",
  res: Response,
): Promise<void> {
  const baseUrl = process.env.ANYBOT_DESKTOP_UPDATE_URL;
  const token = process.env.ANYBOT_DESKTOP_UPDATE_TOKEN;

  if (!baseUrl || !token) {
    const status = getDesktopUpdateUnavailableStatus();
    res.json(endpoint === "/check" ? await checkLatestGitHubReleaseStatus(status) : getManualDesktopUpdateStatus(status));
    return;
  }

  try {
    const response = await undiciFetch(new URL(endpoint, baseUrl).toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || "桌面更新服务返回了无效响应" };
    }
    const payloadRecord = asRecord(payload);
    if (response.ok && shouldUseManualReleaseCheck(payloadRecord)) {
      const status = normalizeManualDesktopUpdateStatus(payloadRecord);
      res.status(response.status).json(endpoint === "/check" ? await checkLatestGitHubReleaseStatus(status) : getManualDesktopUpdateStatus(status));
      return;
    }
    res.status(response.status).json(payload);
  } catch (error) {
    logger.warn("desktop_update.proxy_failed", {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({
      ...normalizeManualDesktopUpdateStatus(getDesktopUpdateUnavailableStatus()),
      state: "error",
      message: "连接桌面更新服务失败。",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function checkDesktopUpdateOnStartup(): Promise<void> {
  const baseUrl = process.env.ANYBOT_DESKTOP_UPDATE_URL;
  const token = process.env.ANYBOT_DESKTOP_UPDATE_TOKEN;

  if (!baseUrl || !token) {
    await checkLatestGitHubReleaseStatus(getDesktopUpdateUnavailableStatus());
    logger.info("desktop_update.startup_checked", { mode: "manual" });
    return;
  }

  try {
    const response = await undiciFetch(new URL("/check", baseUrl).toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || "桌面更新服务返回了无效响应" };
    }

    if (!response.ok) {
      logger.warn("desktop_update.startup_check_failed", {
        status: response.status,
        error: getObjectStringValue(payload, "error") || getObjectStringValue(payload, "message"),
      });
      return;
    }

    const payloadRecord = asRecord(payload);
    if (shouldUseManualReleaseCheck(payloadRecord)) {
      await checkLatestGitHubReleaseStatus(normalizeManualDesktopUpdateStatus(payloadRecord));
      logger.info("desktop_update.startup_checked", { mode: "manual" });
      return;
    }

    logger.info("desktop_update.startup_checked", { mode: "desktop" });
  } catch (error) {
    logger.warn("desktop_update.startup_check_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// 图片扩展名集合
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif", ".heic", ".heif", ".avif"]);

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function getUploadDir(): string {
  return path.join(getWorkdir(), "tmp", "uploads");
}

function readMessagePageQuery(req: Request): { beforeId: number | null; limit: number } {
  const beforeRaw = Array.isArray(req.query.before) ? req.query.before[0] : req.query.before;
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const before = beforeRaw ? Number(beforeRaw) : null;
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_SESSION_MESSAGE_LIMIT;
  return {
    beforeId: before && Number.isFinite(before) && before > 0 ? Math.floor(before) : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_SESSION_MESSAGE_LIMIT,
  };
}

type ClientChatMessage = db.ChatMessage & {
  contentTruncated?: boolean;
  contentChars?: number;
};

async function prepareMessagesForClient(
  messages: db.ChatMessage[],
): Promise<ClientChatMessage[]> {
  const hydrated = await hydrateChangeReviewMetadata(messages);
  return hydrated.map((message) => {
    let metadata = message.metadata;
    if (metadata) {
      try {
        const parsed = JSON.parse(metadata) as Record<string, unknown>;
        const loop = parsed.claudeAgentLoop as { events?: ClaudeAgentStreamEvent[] } | undefined;
        if (loop && Array.isArray(loop.events)) {
          parsed.claudeAgentLoop = {
            ...loop,
            events: compactAgentEvents(loop.events),
          };
          metadata = JSON.stringify(parsed);
        }
      } catch {
        metadata = message.metadata;
      }
    }

    if (message.content.length <= MESSAGE_PREVIEW_CHARS) {
      return { ...message, metadata };
    }

    return {
      ...message,
      metadata,
      content: `${message.content.slice(0, MESSAGE_PREVIEW_CHARS)}\n\n...[内容较长，已折叠]`,
      contentTruncated: true,
      contentChars: message.content.length,
    };
  });
}

async function hydrateChangeReviewMetadata(
  messages: db.ChatSession["messages"],
): Promise<db.ChatSession["messages"]> {
  return Promise.all(
    messages.map(async (message) => {
      if (!message.metadata) return message;
      try {
        const metadata = JSON.parse(message.metadata) as Record<string, unknown>;
        const existing = metadata.changeReview as { id?: string } | undefined;
        if (!existing?.id) return message;
        const hydrated = await getChangeReview(existing.id);
        if (!hydrated) return message;
        return {
          ...message,
          metadata: JSON.stringify({ ...metadata, changeReview: hydrated }),
        };
      } catch {
        return message;
      }
    }),
  );
}

function normalizeProjectPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("缺少项目路径");
  }
  const resolved = fs.realpathSync(path.resolve(inputPath));
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error("项目路径必须是文件夹");
  }
  return resolved;
}

function migrateWorkspaceMemoryFiles(sourceDir: string, targetDir: string): string[] {
  const from = path.resolve(sourceDir);
  const to = path.resolve(targetDir);
  if (from === to) return [];

  const copied: string[] = [];
  for (const file of WORKSPACE_MEMORY_FILES) {
    const source = path.join(from, file);
    const target = path.join(to, file);
    try {
      if (!fs.existsSync(source) || fs.existsSync(target)) continue;
      fs.copyFileSync(source, target);
      copied.push(file);
    } catch (error) {
      logger.warn("workspace.memory_migration_file_failed", { file, source, target, error });
    }
  }
  return copied;
}

function createOrTouchProject(projectPath: string): db.Project {
  const normalizedPath = normalizeProjectPath(projectPath);
  const existing = db.findProjectByPath(normalizedPath);
  if (existing) {
    const updatedAt = Date.now();
    db.touchProject(existing.id, updatedAt);
    emitProjectsChanged(existing.id, "project_touched");
    return { ...existing, updatedAt };
  }
  const now = Date.now();
  const project: db.Project = {
    id: generateId(),
    name: path.basename(normalizedPath) || normalizedPath,
    path: normalizedPath,
    createdAt: now,
    updatedAt: now,
  };
  db.createProject(project);
  emitProjectsChanged(project.id, "project_created");
  return project;
}

function isFolderPickerCanceled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; stderr?: unknown };
  const text = `${String(candidate.message || "")}\n${String(candidate.stderr || "")}`;
  return candidate.code === 2 || text.includes("(-128)") || text.includes("用户已取消") || text.includes("User canceled") || text.includes("User cancelled");
}

function resolveFolderPickerDefaultPath(defaultPath?: string): string | null {
  if (!defaultPath) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(defaultPath));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteAppleScriptString(value: string): string {
  return JSON.stringify(value);
}

async function pickProjectFolder(opts: { defaultPath?: string; prompt?: string } = {}): Promise<string | null> {
  let stdout = "";
  const prompt = opts.prompt || "选择项目文件夹";
  const defaultPath = resolveFolderPickerDefaultPath(opts.defaultPath);

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = ${quotePowerShellString(prompt)}`,
      "$dialog.ShowNewFolderButton = $true",
      ...(defaultPath ? [`$dialog.SelectedPath = ${quotePowerShellString(defaultPath)}`] : []),
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.WriteLine($dialog.SelectedPath)",
      "  exit 0",
      "}",
      "exit 2",
    ].join("\n");
    try {
      const result = await execFile("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ]);
      stdout = result.stdout;
    } catch (error) {
      if (isFolderPickerCanceled(error)) {
        return null;
      }
      throw error;
    }
    return stdout.trim();
  }

  if (process.platform !== "darwin") {
    throw new Error("当前系统暂不支持从浏览器唤起本地文件夹选择器");
  }

  try {
    const script = defaultPath
      ? `POSIX path of (choose folder with prompt ${quoteAppleScriptString(prompt)} default location POSIX file ${quoteAppleScriptString(defaultPath)})`
      : `POSIX path of (choose folder with prompt ${quoteAppleScriptString(prompt)})`;
    const result = await execFile("osascript", [
      "-e",
      script,
    ]);
    stdout = result.stdout;
  } catch (error) {
    if (isFolderPickerCanceled(error)) {
      return null;
    }
    throw error;
  }
  return stdout.trim();
}

function ensurePathInsideProject(projectPath: string, relativePath: string): string {
  const root = normalizeProjectPath(projectPath);
  const target = path.resolve(root, relativePath || ".");
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("目录路径越界");
  }
  return target;
}

function readProjectTree(project: db.Project, relativePath: string): Array<{
  name: string;
  path: string;
  type: "directory" | "file";
}> {
  const target = ensurePathInsideProject(project.path, relativePath);
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    throw new Error("目标路径不是文件夹");
  }

  return fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .slice(0, 200)
    .map((entry) => ({
      name: entry.name,
      path: path.relative(project.path, path.join(target, entry.name)),
      type: entry.isDirectory() ? "directory" as const : "file" as const,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function getSessionWorkdir(session: Pick<db.ChatSession, "projectId">): string {
  if (!session.projectId) return getWorkdir();
  const project = db.getProject(session.projectId);
  if (!project) {
    throw new Error("项目不存在");
  }
  return normalizeProjectPath(project.path);
}

type ChatAttachment = { path: string; name: string };
type ChatPromptSkill = { id?: string; name?: string };
type ChatPromptProject = { id?: string; name?: string; path?: string };

function normalizeWebChatSkills(skills: ChatPromptSkill[] = []): Array<{ id?: string; name: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ id?: string; name: string }> = [];
  for (const skill of skills) {
    const name = String(skill?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push({
      ...(skill.id ? { id: String(skill.id) } : {}),
      name,
    });
    if (normalized.length >= 8) break;
  }
  return normalized;
}

function normalizeWebChatProjects(projects: ChatPromptProject[] = []): Array<{ id: string; name: string; path: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ id: string; name: string; path: string }> = [];

  for (const item of projects) {
    const id = String(item?.id || "").trim();
    const itemPath = String(item?.path || "").trim();
    let project: db.Project | null = id ? db.getProject(id) : null;
    if (!project && itemPath) {
      try {
        project = db.findProjectByPath(normalizeProjectPath(itemPath));
      } catch {
        project = null;
      }
    }
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    normalized.push({
      id: project.id,
      name: project.name,
      path: project.path,
    });
    if (normalized.length >= 12) break;
  }

  return normalized;
}

function getWebChatSelectionFallback(
  skills: Array<{ id?: string; name: string }>,
  projects: Array<{ id: string; name: string; path: string }>,
): string {
  const parts: string[] = [];
  if (skills.length > 0) {
    parts.push(`使用技能：${skills.map((skill) => skill.name).join("、")}`);
  }
  if (projects.length > 0) {
    parts.push(`涉及项目：${projects.map((project) => project.name).join("、")}`);
  }
  return parts.join("\n");
}

function prepareWebChatInput(
  content?: string,
  attachments: ChatAttachment[] = [],
  skills: ChatPromptSkill[] = [],
  projects: ChatPromptProject[] = [],
) {
  let userText = (content || "").trim();
  const imagePaths: string[] = [];
  const filePaths: ChatAttachment[] = [];
  const skillInfo = normalizeWebChatSkills(skills);
  const projectInfo = normalizeWebChatProjects(projects);

  if (skillInfo.length > 0) {
    const skillNames = skillInfo.map((skill) => skill.name).join("、");
    const skillPrompt = `本轮请使用这些技能：${skillNames}`;
    userText = userText ? `${skillPrompt}\n\n${userText}` : skillPrompt;
  }

  if (projectInfo.length > 0) {
    const projectList = projectInfo.map((project) => `- ${project.name}: ${project.path}`).join("\n");
    const projectPrompt = `本轮涉及以下项目。处理文件时必须按项目名使用对应绝对路径：\n${projectList}`;
    userText = userText ? `${projectPrompt}\n\n${userText}` : projectPrompt;
  }

  for (const att of attachments) {
    if (isImageFile(att.name)) {
      imagePaths.push(att.path);
    } else {
      filePaths.push(att);
    }
  }

  if (filePaths.length > 0) {
    const fileList = filePaths.map((f) => `- ${f.name}: ${f.path}`).join("\n");
    userText = `${userText}\n\n用户附带了以下文件，请读取并处理：\n${fileList}`;
  }
  if (imagePaths.length > 0) {
    const imgList = imagePaths.map((p) => `- ${path.basename(p)}: ${p}`).join("\n");
    userText = `${userText}\n\n用户附带了以下图片：\n${imgList}`;
  }

  const attachmentInfo = attachments.map((a) => ({ name: a.name, path: a.path }));
  const metadata = {
    ...(attachmentInfo.length > 0 ? { attachments: attachmentInfo } : {}),
    ...(skillInfo.length > 0 ? { skills: skillInfo } : {}),
    ...(projectInfo.length > 0 ? { projects: projectInfo } : {}),
  };
  const selectionFallback = getWebChatSelectionFallback(skillInfo, projectInfo);
  const storedFallback = selectionFallback
    ? selectionFallback
    : "[附件]";
  return {
    userText,
    imagePaths,
    fileCount: filePaths.length,
    skillCount: skillInfo.length,
    projectCount: projectInfo.length,
    storedUserContent: content?.trim() || storedFallback,
    titleText: content?.trim() || (selectionFallback ? storedFallback : "文件分析"),
    userMetadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
  };
}

// multer 配置：保留原始扩展名
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // 每次上传时确保目录存在（防止运行中被删除）
    const uploadDir = getUploadDir();
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cb(null, `${base}-${unique}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB 上限

export function chatRouter(): Router {
  const router = Router();

  router.get("/events", (_req: Request, res: Response) => {
    attachWebUiEventClient(res);
  });

  router.get("/projects", (_req: Request, res: Response) => {
    res.json(db.listProjects());
  });

  router.post("/projects", (req: Request, res: Response) => {
    const { path: projectPath } = req.body as { path?: string };
    try {
      const project = createOrTouchProject(projectPath || "");
      res.json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "添加项目失败" });
    }
  });

  router.post("/projects/pick", async (_req: Request, res: Response) => {
    try {
      const projectPath = await pickProjectFolder({ defaultPath: getWorkdir() });
      if (!projectPath) {
        res.json({ canceled: true });
        return;
      }
      const project = createOrTouchProject(projectPath);
      res.json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "选择项目失败" });
    }
  });

  router.get("/projects/:id/tree", (req: Request, res: Response) => {
    const project = db.getProject(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: "项目不存在" });
      return;
    }

    try {
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      res.json({
        projectId: project.id,
        path: relativePath,
        children: readProjectTree(project, relativePath),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "读取目录失败" });
    }
  });

  router.get("/sessions", (_req: Request, res: Response) => {
    const list = db.listSessions();
    res.json(list);
  });

  router.post("/sessions", (req: Request, res: Response) => {
    const { projectId } = req.body as { projectId?: string | null };
    if (projectId && !db.getProject(projectId)) {
      res.status(404).json({ error: "项目不存在" });
      return;
    }

    const session: db.ChatSession = {
      id: generateId(),
      title: "新对话",
      sessionId: null,
      provider: getProvider().type,
      source: "web",
      chatId: null,
      projectId: projectId || null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.createSession(session);
    emitSessionsChanged(session.id, "session_created");
    res.json({
      id: session.id,
      title: session.title,
      projectId: session.projectId,
      provider: session.provider,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });

  router.get("/sessions/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    const page = db.getMessagesPage(id, readMessagePageQuery(req));
    res.json({
      id: session.id,
      title: session.title,
      provider: session.provider,
      source: session.source,
      projectId: session.projectId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: await prepareMessagesForClient(page.messages),
      hasMoreMessages: page.hasMore,
      activeStream: getActiveAgentStreamInfo(session.id),
    });
  });

  router.get("/sessions/:id/messages", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    const page = db.getMessagesPage(id, readMessagePageQuery(req));
    res.json({
      messages: await prepareMessagesForClient(page.messages),
      hasMoreMessages: page.hasMore,
    });
  });

  router.get("/sessions/:id/messages/:messageId/content", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      res.status(400).json({ error: "消息 ID 无效" });
      return;
    }
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    const content = db.getMessageContent(id, Math.floor(messageId));
    if (content == null) {
      res.status(404).json({ error: "消息不存在" });
      return;
    }
    res.json({ content });
  });

  router.delete("/sessions/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    db.deleteSession(id);
    emitSessionsChanged(id, "session_deleted");
    res.json({ ok: true });
  });

  // --- App settings ---

  router.get("/app-settings", (_req: Request, res: Response) => {
    try {
      res.json({
        settings: readAppSettings(),
        effective: {
          dataDir: getDataDir(),
          logDir: getLogDir(),
          workdir: getWorkdir(),
          uploadDir: getUploadDir(),
        },
      });
    } catch (error) {
      res.status(500).json({ error: "读取设置失败" });
    }
  });

  router.put("/app-settings", (req: Request, res: Response) => {
    try {
      const settings = req.body as Partial<AppSettings>;
      const previousWorkdir = getWorkdir();
      let requestedWorkdir: string | undefined;
      if (settings.workspace?.defaultWorkdir) {
        settings.workspace.defaultWorkdir = normalizeProjectPath(settings.workspace.defaultWorkdir);
        requestedWorkdir = settings.workspace.defaultWorkdir;
      }
      const next = updateAppSettings(settings);
      const migratedMemoryFiles = requestedWorkdir
        ? [
            ...migrateWorkspaceMemoryFiles(previousWorkdir, next.workspace.defaultWorkdir),
            ...migrateWorkspaceMemoryFiles(process.cwd(), next.workspace.defaultWorkdir),
          ]
        : [];
      if (migratedMemoryFiles.length > 0) {
        logger.info("workspace.memory_migrated", { from: previousWorkdir, to: next.workspace.defaultWorkdir, files: migratedMemoryFiles });
      }
      logger.info("app_settings.updated");
      res.json({
        settings: next,
        effective: {
          dataDir: getDataDir(),
          logDir: getLogDir(),
          workdir: getWorkdir(),
          uploadDir: getUploadDir(),
        },
        migratedMemoryFiles,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "保存设置失败" });
    }
  });

  router.get("/desktop-update/status", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/status", "GET", res);
  });

  router.post("/desktop-update/check", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/check", "POST", res);
  });

  router.post("/desktop-update/download", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/download", "POST", res);
  });

  router.post("/desktop-update/restart", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/restart", "POST", res);
  });

  router.post("/app-settings/default-workdir/pick", async (_req: Request, res: Response) => {
    try {
      const selected = await pickProjectFolder({
        defaultPath: getWorkdir(),
        prompt: "变更默认工作目录",
      });
      if (!selected) {
        res.json({ canceled: true });
        return;
      }
      res.json({ path: normalizeProjectPath(selected) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "选择默认工作目录失败" });
    }
  });

  router.post("/app-settings/default-workdir/open", (_req: Request, res: Response) => {
    try {
      const workdir = getWorkdir();
      openDirectory(workdir);
      res.json({ ok: true, path: workdir });
    } catch (error) {
      res.status(500).json({ error: "打开工作区文件夹失败" });
    }
  });

  // --- Model & Provider config ---

  router.post("/provider-models", async (req: Request, res: Response) => {
    const body = req.body as { baseUrl?: unknown; apiKey?: unknown } | undefined;
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!baseUrl || !apiKey) {
      res.status(400).json({ error: "缺少 Base URL 或 API Key" });
      return;
    }

    let modelsUrl: string;
    let provider: string;
    try {
      const request = buildProviderModelsRequest(baseUrl);
      modelsUrl = request.modelsUrl;
      provider = request.provider;
    } catch (error) {
      const msg = error instanceof Error && (error.message.includes("VibeAPI") || error.message.includes("DeepSeek"))
        ? error.message
        : "Base URL 无效";
      res.status(400).json({ error: msg });
      return;
    }

    const now = Date.now();
    const cacheKey = getProviderModelCacheKey(modelsUrl, apiKey);
    const cached = providerModelCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.json({
        models: cached.models,
        provider: cached.provider,
        cached: true,
        expiresAt: new Date(cached.expiresAt).toISOString(),
      });
      return;
    }
    if (cached) providerModelCache.delete(cacheKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_MODEL_FETCH_TIMEOUT_MS);
    try {
      const response = await undiciFetch(modelsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = {};
      }
      if (!response.ok) {
        const upstreamError = getObjectStringValue(payload, "error") || text || "获取模型列表失败";
        res.status(response.status).json({ error: upstreamError });
        return;
      }

      const models = extractProviderModelIds(payload);
      if (models.length === 0) {
        res.status(502).json({ error: "模型列表为空或格式不支持" });
        return;
      }

      const expiresAt = Date.now() + PROVIDER_MODEL_CACHE_TTL_MS;
      providerModelCache.set(cacheKey, { models, provider, expiresAt });
      res.json({ models, provider, cached: false, expiresAt: new Date(expiresAt).toISOString() });
    } catch (error) {
      const msg = error instanceof Error && error.name === "AbortError"
        ? "获取模型列表超时"
        : error instanceof Error
          ? error.message
          : "获取模型列表失败";
      logger.warn("provider_models.fetch_failed", {
        provider,
        modelsUrl,
        error: msg,
      });
      res.status(502).json({ error: msg });
    } finally {
      clearTimeout(timeout);
    }
  });

  router.get("/model-config", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : "";
      res.json(provider ? readModelConfigForProvider(provider) : readModelConfig());
    } catch (error) {
      res.status(500).json({ error: "读取模型配置失败" });
    }
  });

  router.put("/model-config", (req: Request, res: Response) => {
    const { modelId, provider } = req.body as { modelId?: string; provider?: string };
    if (!modelId) {
      res.status(400).json({ error: "缺少 modelId" });
      return;
    }
    try {
      const config = provider ? setModelForProvider(provider, modelId) : setCurrentModel(modelId);
      logger.info("model.switched", { modelId, provider: provider || config.provider });
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换模型失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/providers", (_req: Request, res: Response) => {
    try {
      const providers = getProviderTypes();
      const current = getProvider().type;
      res.json({ current, providers });
    } catch (error) {
      res.status(500).json({ error: "读取 Provider 列表失败" });
    }
  });

  router.put("/providers/current", (req: Request, res: Response) => {
    const { provider } = req.body as { provider?: string };
    if (!provider) {
      res.status(400).json({ error: "缺少 provider" });
      return;
    }
    try {
      const config = setCurrentProvider(provider);
      logger.info("provider.switched", { provider });
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换 Provider 失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/sandbox-config", (_req: Request, res: Response) => {
    try {
      res.json({
        ...readSandboxConfig(),
        modes: sandboxModeOptions,
      });
    } catch (error) {
      res.status(500).json({ error: "读取权限配置失败" });
    }
  });

  router.put("/sandbox-config", (req: Request, res: Response) => {
    const { defaultSandbox } = req.body as { defaultSandbox?: string };
    if (!defaultSandbox) {
      res.status(400).json({ error: "缺少 defaultSandbox" });
      return;
    }
    try {
      const config = setDefaultSandbox(defaultSandbox);
      logger.info("sandbox.switched", { sandbox: config.defaultSandbox });
      res.json({
        ...config,
        modes: sandboxModeOptions,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "保存权限配置失败";
      res.status(400).json({ error: msg });
    }
  });

  // --- Channels ---

  router.get("/channels", (_req: Request, res: Response) => {
    try {
      const config = readChannelsConfig();
      const registered = getRegisteredChannelTypes();
      res.json({ registered, config });
    } catch (error) {
      res.status(500).json({ error: "读取频道配置失败" });
    }
  });

  router.put("/channels/:type", (req: Request, res: Response) => {
    const channelType = req.params.type as string;
    const registered = getRegisteredChannelTypes();
    if (!registered.includes(channelType)) {
      res.status(400).json({ error: `不支持的频道类型: ${channelType}` });
      return;
    }
    try {
      const config = updateChannelConfig(channelType, req.body);
      logger.info("channel.config.updated", { channelType });
      res.json(config);

      channelManager.restartChannel(channelType).catch((error) => {
        logger.error("channel.restart_after_save_failed", { channelType, error });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新频道配置失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/channels/weixin/login-status", (_req: Request, res: Response) => {
    res.json(getWeixinLoginStatus());
  });

  // --- Skills ---

  router.get("/slash/items", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      res.json(listWebSlashItems(provider));
    } catch (error) {
      res.status(500).json({ error: "读取快捷项失败" });
    }
  });

  router.get("/skills", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      res.json(listSkills(provider));
    } catch (error) {
      res.status(500).json({ error: "读取技能列表失败" });
    }
  });

  router.get("/skills/mentions", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      res.json({ skills: listSkillMentions(provider) });
    } catch (error) {
      res.status(500).json({ error: "读取技能列表失败" });
    }
  });

  router.put("/skills/:id/toggle", (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id as string);
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "缺少 enabled 参数" });
      return;
    }
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      const result = toggleSkill(id, enabled, provider);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      logger.info("skill.toggled", { id, enabled });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "切换技能状态失败" });
    }
  });

  router.delete("/skills/:id", (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id as string);
    const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const result = deleteSkill(id, provider);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    logger.info("skill.deleted", { id });
    res.json({ ok: true });
  });

  router.post("/skills/open-folder", (req: Request, res: Response) => {
    try {
      const skillPath = req.body?.path as string | undefined;
      const provider = typeof req.body?.provider === "string" ? req.body.provider : undefined;
      openSkillsFolder(skillPath, provider);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开文件夹失败" });
    }
  });

  // --- Proxy ---

  router.get("/proxy", (_req: Request, res: Response) => {
    try {
      const config = readProxyConfig();
      res.json({
        ...config,
        enabled: isProxyFeatureEnabled() ? config.enabled : false,
        featureEnabled: isProxyFeatureEnabled(),
      });
    } catch (error) {
      res.status(500).json({ error: "读取代理配置失败" });
    }
  });

  router.put("/proxy", (req: Request, res: Response) => {
    try {
      if (!isProxyFeatureEnabled()) {
        applyProxy();
        res.json({
          ...readProxyConfig(),
          enabled: false,
          featureEnabled: false,
        });
        return;
      }

      const body = req.body as Partial<ProxyConfig>;
      const current = readProxyConfig();
      const config: ProxyConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        protocol: body.protocol === "socks5" ? "socks5" : "http",
        host: typeof body.host === "string" ? body.host.trim() : current.host,
        port: typeof body.port === "number" && body.port > 0 ? body.port : current.port,
        username: typeof body.username === "string" ? body.username : current.username,
        password: typeof body.password === "string" ? body.password : current.password,
      };
      writeProxyConfig(config);
      applyProxy(config);
      logger.info("proxy.config.updated", {
        enabled: config.enabled,
        protocol: config.protocol,
        host: config.host,
        port: config.port,
      });
      res.json({ ...config, featureEnabled: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新代理配置失败";
      res.status(400).json({ error: msg });
    }
  });

  router.post("/proxy/test", async (req: Request, res: Response) => {
    if (!isProxyFeatureEnabled()) {
      res.json({ ok: false, error: "代理功能已暂时关闭" });
      return;
    }

    const body = req.body as Partial<ProxyConfig> | undefined;
    const testConfig: ProxyConfig = {
      enabled: true,
      protocol: body?.protocol === "socks5" ? "socks5" : "http",
      host: (typeof body?.host === "string" && body.host.trim()) || "127.0.0.1",
      port: (typeof body?.port === "number" && body.port > 0) ? body.port : 7890,
    };
    if (body?.username) testConfig.username = body.username;
    if (body?.password) testConfig.password = body.password;

    const proxyUrl = getProxyUrl(testConfig);
    if (!proxyUrl) {
      res.json({ ok: false, error: "代理地址无效" });
      return;
    }

    let agent: ProxyAgent | null = null;
    try {
      agent = new ProxyAgent(proxyUrl);
      const testUrl = "https://www.google.com/generate_204";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const start = Date.now();
      const response = await undiciFetch(testUrl, {
        dispatcher: agent,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latency = Date.now() - start;
      res.json({ ok: response.ok || response.status === 204, latency, status: response.status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "连接失败";
      res.json({ ok: false, error: msg });
    } finally {
      agent?.close();
    }
  });

  // --- Logs & data ---

  router.post("/logs/open", (_req: Request, res: Response) => {
    try {
      fs.mkdirSync(getLogDir(), { recursive: true });
      openDirectory(getLogDir());
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开日志目录失败" });
    }
  });

  router.delete("/logs", (_req: Request, res: Response) => {
    try {
      fs.rmSync(getLogDir(), { recursive: true, force: true });
      fs.mkdirSync(getLogDir(), { recursive: true });
      logger.info("logs.cleared");
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "清空日志失败" });
    }
  });

  router.post("/data/open", (_req: Request, res: Response) => {
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      openDirectory(getDataDir());
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开数据目录失败" });
    }
  });

  router.delete("/data/uploads", (_req: Request, res: Response) => {
    try {
      fs.rmSync(getUploadDir(), { recursive: true, force: true });
      fs.mkdirSync(getUploadDir(), { recursive: true });
      logger.info("uploads.cleared");
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "清理上传文件失败" });
    }
  });

  router.delete("/data/history", (_req: Request, res: Response) => {
    try {
      db.deleteAllSessions();
      emitHistoryCleared();
      logger.info("history.cleared");
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "清空历史失败" });
    }
  });

  router.get("/data/export", (_req: Request, res: Response) => {
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        appSettings: readAppSettings(),
        modelConfig: readModelConfig(),
        sandboxConfig: readSandboxConfig(),
        proxyConfig: readProxyConfig(),
        channelsConfig: readChannelsConfig(),
      };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="anybot-config-${Date.now()}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      res.status(500).json({ error: "导出配置失败" });
    }
  });

  router.put("/data/import", (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        appSettings?: AppSettings;
        modelConfig?: ReturnType<typeof readModelConfig>;
        sandboxConfig?: ReturnType<typeof readSandboxConfig>;
        proxyConfig?: ProxyConfig;
        channelsConfig?: ReturnType<typeof readChannelsConfig>;
      };
      if (payload.appSettings) writeAppSettings(payload.appSettings);
      if (payload.modelConfig) writeModelConfig(payload.modelConfig);
      if (payload.sandboxConfig?.defaultSandbox) setDefaultSandbox(payload.sandboxConfig.defaultSandbox);
      if (payload.proxyConfig) {
        if (isProxyFeatureEnabled()) {
          writeProxyConfig(payload.proxyConfig);
          applyProxy(payload.proxyConfig);
        } else {
          applyProxy();
        }
      }
      if (payload.channelsConfig) writeChannelsConfig(payload.channelsConfig);
      logger.info("data.imported");
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "导入配置失败" });
    }
  });

  // --- Change review actions ---

  router.post("/change-reviews/:id/approve", async (req: Request, res: Response) => {
    try {
      const review = await approveChangeReview(req.params.id as string);
      res.json({ ok: true, review });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "审核失败";
      res.status(404).json({ error: msg });
    }
  });

  router.post("/change-reviews/:id/revert", async (req: Request, res: Response) => {
    try {
      const review = await revertChangeReview(req.params.id as string);
      if (review.status !== "reverted") {
        res.status(409).json({ ok: false, review, error: review.error || "无法安全撤销" });
        return;
      }
      res.json({ ok: true, review });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "撤销失败";
      res.status(404).json({ error: msg });
    }
  });

  // --- Send message to owner via channel bot ---

  router.post("/send", async (req: Request, res: Response) => {
    const { channel, message } = req.body as {
      channel?: string;
      message?: string;
    };

    if (!channel) {
      res.status(400).json({ error: "缺少 channel 参数（feishu / telegram / qqbot / weixin）" });
      return;
    }
    if (!message?.trim()) {
      res.status(400).json({ error: "缺少 message 参数" });
      return;
    }

    const registered = getRegisteredChannelTypes();
    if (!registered.includes(channel)) {
      res.status(400).json({ error: `不支持的频道类型: ${channel}，可选: ${registered.join(", ")}` });
      return;
    }

    const ch = channelManager.getChannel(channel);
    if (!ch) {
      const running = channelManager.getRunningChannelTypes();
      res.status(400).json({
        error: `频道 ${channel} 未启动，当前运行中: ${running.length ? running.join(", ") : "无"}`,
      });
      return;
    }

    try {
      await ch.sendToOwner(message.trim());
      logger.info("api.send.success", { channel, messageChars: message.trim().length });
      res.json({ ok: true });
    } catch (error) {
      logger.error("api.send.failed", { channel, error });
      const msg = error instanceof Error ? error.message : "发送消息失败";
      res.status(500).json({ error: msg });
    }
  });

  // --- 文件上传 ---

  router.post("/upload", upload.single("file"), (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "未收到文件" });
      return;
    }
    const absPath = path.resolve(file.path);
    logger.info("web.upload.success", { name: file.originalname, path: absPath, size: file.size });
    res.json({
      path: absPath,
      name: file.originalname,
      size: file.size,
      isImage: isImageFile(file.originalname),
    });
  });

  // --- 本地文件代理（让浏览器能访问本地图片） ---

  router.get("/local-file", (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: "缺少 path 参数" });
      return;
    }
    if (!isImageFile(filePath)) {
      res.status(403).json({ error: "只允许访问图片文件" });
      return;
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "文件不存在" });
      return;
    }
    res.sendFile(resolved);
  });

  // --- Chat messages ---

  router.get("/sessions/:id/messages/stream", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (!attachAgentStreamClient(id, res)) {
      res.status(404).json({ error: "当前会话没有正在进行的流式响应" });
      return;
    }
  });

  router.post("/sessions/:id/messages/cancel", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    const controller = activeRunControllers.get(id);
    if (!controller) {
      res.status(409).json({ error: "当前会话没有正在处理的 Claude/Codex 请求" });
      return;
    }

    controller.abort();
    logger.info("web.chat.cancel.requested", { sessionId: id, provider: session.provider });
    res.json({ ok: true });
  });

  router.post("/sessions/:id/messages/stream", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (hasActiveAgentStream(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再发送新消息" });
      return;
    }

    const { content, attachments, skills, projects, modelId } = req.body as {
      content?: string;
      attachments?: ChatAttachment[];
      skills?: ChatPromptSkill[];
      projects?: ChatPromptProject[];
      modelId?: string;
    };
    const requestAttachments = Array.isArray(attachments) ? attachments : [];
    const requestSkills = Array.isArray(skills) ? skills : [];
    const requestProjects = Array.isArray(projects) ? projects : [];
    const input = prepareWebChatInput(content, requestAttachments, requestSkills, requestProjects);
    if (!input.userText && requestAttachments.length === 0) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    let prepared: PreparedChatTurn;
    try {
      prepared = prepareChatTurn({
        session,
        userText: input.userText,
        storedUserContent: input.storedUserContent,
        titleText: input.titleText,
        userMetadata: input.userMetadata,
        imagePaths: input.imagePaths,
        modelId,
        workdir: sessionWorkdir,
        includeWorkspaceMemory: !session.projectId,
        requireStreaming: true,
      });
    } catch (error) {
      if (error instanceof ChatTurnValidationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "模型不可用" });
      return;
    }

    const runAbortController = new AbortController();
    activeRunControllers.set(id, runAbortController);
    const active = createActiveAgentStream(id);
    attachAgentStreamClient(id, res);

    const emit = (event: AgentStreamEvent) => emitAgentStream(active, event);

    void (async () => {
      try {
        await runPreparedChatTurn(prepared, {
          signal: runAbortController.signal,
          stream: { emit },
          logPrefix: "web.chat.stream",
          logFields: { fileCount: input.fileCount, skillCount: input.skillCount, projectCount: input.projectCount },
        });
      } catch {
        // runPreparedChatTurn 已记录日志并推送 error 事件，这里只负责收尾。
      } finally {
        activeRunControllers.delete(id);
        finishAgentStream(id, active);
      }
    })();
  });

  router.post("/sessions/:id/messages", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    if (hasActiveAgentStream(id)) {
      res.status(423).json({ error: "当前会话正在处理中，请稍后再发送新消息" });
      return;
    }

    const { content, attachments, skills, projects, modelId } = req.body as {
      content?: string;
      attachments?: ChatAttachment[];
      skills?: ChatPromptSkill[];
      projects?: ChatPromptProject[];
      modelId?: string;
    };
    const requestAttachments = Array.isArray(attachments) ? attachments : [];
    const requestSkills = Array.isArray(skills) ? skills : [];
    const requestProjects = Array.isArray(projects) ? projects : [];
    const input = prepareWebChatInput(content, requestAttachments, requestSkills, requestProjects);
    if (!input.userText && requestAttachments.length === 0) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }

    let sessionWorkdir: string;
    try {
      sessionWorkdir = getSessionWorkdir(session);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "项目目录不可用" });
      return;
    }

    try {
      const result = await runChatTurn({
        session,
        userText: input.userText,
        storedUserContent: input.storedUserContent,
        titleText: input.titleText,
        userMetadata: input.userMetadata,
        imagePaths: input.imagePaths,
        modelId,
        workdir: sessionWorkdir,
        includeWorkspaceMemory: !session.projectId,
        logPrefix: "web.chat",
        logFields: { fileCount: input.fileCount, skillCount: input.skillCount, projectCount: input.projectCount },
      });

      res.json({
        role: "assistant",
        content: result.content,
        title: result.title,
        provider: result.provider,
        changeReview: result.changeReview,
        contextUsage: result.contextUsage,
      });
    } catch (error) {
      if (error instanceof ChatTurnValidationError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "处理消息时出错了，请稍后再试。";
      res.status(500).json({ error: errorMessage });
    }
  });

  return router;
}
