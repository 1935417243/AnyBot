import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDataDir } from "../../app-settings.js";
import { logger } from "../../logger.js";
import { generateId, getWorkdir } from "../../shared.js";
import { spawnCommand } from "../../utils/process.js";
import * as db from "../db.js";
import { emitProjectsChanged, emitSessionsChanged } from "../events.js";

const execFile = promisify(execFileCallback);
const WORKSPACE_MEMORY_FILES = ["AGENTS.md", "MEMORY.md", "PROFILE.md"] as const;
const GIT_OUTPUT_LIMIT = 1024 * 1024;
const GIT_CREDENTIALS_PATH = path.join(getDataDir(), "git-credentials.json");
const GIT_PROJECT_CONFIG_PATH = path.join(getDataDir(), "git-project-config.json");

export type CloneProjectOptions = {
  url: string;
  parentPath: string;
  projectName: string;
  username?: string;
  password?: string;
  onProgress?: (progress: CloneProjectProgress) => void;
};

export type CloneProjectProgress = {
  percent: number;
  message: string;
};

type GitUrlInfo = {
  rawUrl: string;
  cloneUrl: string;
  protocol: "https" | "ssh";
  credentialHost?: string;
  credentialUrl?: URL;
  username?: string;
  password?: string;
};

type GitCredentialsFile = {
  hosts: Record<string, {
    username: string;
    password: string;
    updatedAt: number;
  }>;
};

type GitProjectConfig = {
  defaultSaveDirectory?: string;
};

export type SavedGitCredentialSummary = {
  host: string;
  username: string;
  hasPassword: boolean;
  password: string;
};

class GitCommandError extends Error {
  stdout: string;
  stderr: string;
  exitCode: number | null;

  constructor(message: string, opts: { stdout?: string; stderr?: string; exitCode?: number | null } = {}) {
    super(message);
    this.stdout = opts.stdout || "";
    this.stderr = opts.stderr || "";
    this.exitCode = opts.exitCode ?? null;
  }
}

export function normalizeProjectPath(inputPath: string): string {
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

export function migrateWorkspaceMemoryFiles(sourceDir: string, targetDir: string): string[] {
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

export function createOrTouchProject(projectPath: string): db.Project {
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

function readGitProjectConfig(): GitProjectConfig {
  try {
    if (!fs.existsSync(GIT_PROJECT_CONFIG_PATH)) return {};
    const raw = fs.readFileSync(GIT_PROJECT_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GitProjectConfig>;
    return {
      defaultSaveDirectory: typeof parsed.defaultSaveDirectory === "string" ? parsed.defaultSaveDirectory : undefined,
    };
  } catch (error) {
    logger.warn("projects.git_project_config_read_failed", { error });
    return {};
  }
}

function writeGitProjectConfig(config: GitProjectConfig): void {
  fs.mkdirSync(path.dirname(GIT_PROJECT_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(GIT_PROJECT_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getDefaultGitSaveDirectory(): string | null {
  const saved = readGitProjectConfig().defaultSaveDirectory;
  if (!saved) return null;
  try {
    return normalizeProjectPath(saved);
  } catch {
    return null;
  }
}

export function setDefaultGitSaveDirectory(parentPath: string): string {
  const normalizedPath = normalizeParentPath(parentPath);
  writeGitProjectConfig({
    ...readGitProjectConfig(),
    defaultSaveDirectory: normalizedPath,
  });
  return normalizedPath;
}

function normalizeParentPath(parentPath: string): string {
  if (!parentPath || typeof parentPath !== "string") {
    throw new Error("缺少保存目录");
  }
  return normalizeProjectPath(parentPath);
}

function normalizeProjectFolderName(projectName: string): string {
  const name = typeof projectName === "string" ? projectName.trim() : "";
  if (!name) {
    throw new Error("缺少项目名");
  }
  if (name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error("项目名不能包含路径分隔符");
  }
  return name;
}

function isScpLikeSshUrl(value: string): boolean {
  return /^[^@\s]+@[^:\s]+:.+/.test(value);
}

function normalizeGitUrl(rawUrl: string, username?: string, password?: string): GitUrlInfo {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!value) {
    throw new Error("缺少 Git 地址");
  }

  if (/^https:\/\//i.test(value)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Git 地址格式无效");
    }
    const parsedUsername = parsed.username ? decodeURIComponent(parsed.username) : "";
    const parsedPassword = parsed.password ? decodeURIComponent(parsed.password) : "";
    parsed.username = "";
    parsed.password = "";
    return {
      rawUrl: value,
      cloneUrl: parsed.toString(),
      credentialHost: parsed.host.toLowerCase(),
      credentialUrl: parsed,
      protocol: "https",
      username: username || parsedUsername || undefined,
      password: password || parsedPassword || undefined,
    };
  }

  if (/^ssh:\/\//i.test(value) || isScpLikeSshUrl(value)) {
    return {
      rawUrl: value,
      cloneUrl: value,
      protocol: "ssh",
    };
  }

  throw new Error("仅支持 HTTPS 或 SSH Git 地址");
}

function defaultGitCredentialsFile(): GitCredentialsFile {
  return { hosts: {} };
}

function readGitCredentialsFile(): GitCredentialsFile {
  try {
    if (!fs.existsSync(GIT_CREDENTIALS_PATH)) return defaultGitCredentialsFile();
    const raw = fs.readFileSync(GIT_CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GitCredentialsFile>;
    const hosts: GitCredentialsFile["hosts"] = {};
    if (parsed && parsed.hosts && typeof parsed.hosts === "object") {
      for (const [host, credential] of Object.entries(parsed.hosts)) {
        if (!credential || typeof credential !== "object") continue;
        const item = credential as { username?: unknown; password?: unknown; updatedAt?: unknown };
        if (typeof item.username !== "string" || typeof item.password !== "string") continue;
        hosts[host.toLowerCase()] = {
          username: item.username,
          password: item.password,
          updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
        };
      }
    }
    return { hosts };
  } catch (error) {
    logger.warn("projects.git_credentials_read_failed", { error });
    return defaultGitCredentialsFile();
  }
}

function writeGitCredentialsFile(config: GitCredentialsFile): void {
  fs.mkdirSync(path.dirname(GIT_CREDENTIALS_PATH), { recursive: true });
  fs.writeFileSync(GIT_CREDENTIALS_PATH, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(GIT_CREDENTIALS_PATH, 0o600);
  } catch (error) {
    logger.warn("projects.git_credentials_chmod_failed", { error });
  }
}

function readSavedCredentialByHost(host?: string): { username: string; password: string } | null {
  const key = (host || "").trim().toLowerCase();
  if (!key) return null;
  const credential = readGitCredentialsFile().hosts[key];
  if (!credential || !credential.password) return null;
  return {
    username: credential.username,
    password: credential.password,
  };
}

function saveGitCredentialByHost(host: string, username: string, password: string): void {
  const key = host.trim().toLowerCase();
  if (!key || !password) return;
  const config = readGitCredentialsFile();
  config.hosts[key] = {
    username,
    password,
    updatedAt: Date.now(),
  };
  writeGitCredentialsFile(config);
}

function resolveSavedGitCredential(urlInfo: GitUrlInfo): GitUrlInfo {
  if (urlInfo.protocol !== "https") return urlInfo;
  const saved = readSavedCredentialByHost(urlInfo.credentialHost);
  if (!saved) return urlInfo;

  const username = urlInfo.username || saved.username;
  const password = urlInfo.password || (username === saved.username ? saved.password : undefined);
  return {
    ...urlInfo,
    username,
    password,
  };
}

function getDefaultHttpsGitUsername(urlInfo: GitUrlInfo): string {
  const host = urlInfo.credentialHost || urlInfo.credentialUrl?.host.toLowerCase() || "";
  if (host.includes("github.com")) return "x-access-token";
  return "oauth2";
}

export function getSavedGitCredentialSummary(rawUrl: string): SavedGitCredentialSummary | null {
  let urlInfo: GitUrlInfo;
  try {
    urlInfo = normalizeGitUrl(rawUrl);
  } catch {
    return null;
  }
  if (urlInfo.protocol !== "https" || !urlInfo.credentialHost) return null;
  const credential = readSavedCredentialByHost(urlInfo.credentialHost);
  if (!credential) return null;
  return {
    host: urlInfo.credentialHost,
    username: credential.username,
    hasPassword: !!credential.password,
    password: credential.password,
  };
}

function appendLimitedOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk || "");
  return next.length > GIT_OUTPUT_LIMIT ? next.slice(next.length - GIT_OUTPUT_LIMIT) : next;
}

function runGit(args: string[], opts: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
} = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawnCommand("git", args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout = appendLimitedOutput(stdout, text);
      opts.onStdout?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr = appendLimitedOutput(stderr, text);
      opts.onStderr?.(text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new GitCommandError((stderr || stdout || `git exited with ${code}`).trim(), {
        stdout,
        stderr,
        exitCode: code,
      }));
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

function clampClonePercent(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function mapClonePhaseProgress(phasePercent: number, start: number, end: number): number {
  const value = Math.max(0, Math.min(100, phasePercent));
  return start + ((end - start) * value / 100);
}

function parseGitCloneProgressLine(line: string): CloneProjectProgress | null {
  const text = line.replace(/^remote:\s*/i, "").trim();
  if (!text) return null;

  if (/^cloning into/i.test(text)) {
    return { percent: 1, message: "连接仓库" };
  }
  if (/enumerating objects/i.test(text)) {
    return { percent: 3, message: "枚举对象" };
  }

  const percentMatch = text.match(/(\d{1,3})%/);
  if (!percentMatch) return null;
  const phasePercent = Number.parseInt(percentMatch[1], 10);

  if (/counting objects/i.test(text)) {
    return { percent: clampClonePercent(mapClonePhaseProgress(phasePercent, 5, 15)), message: "统计对象" };
  }
  if (/compressing objects/i.test(text)) {
    return { percent: clampClonePercent(mapClonePhaseProgress(phasePercent, 15, 30)), message: "压缩对象" };
  }
  if (/receiving objects/i.test(text)) {
    return { percent: clampClonePercent(mapClonePhaseProgress(phasePercent, 30, 75)), message: "接收对象" };
  }
  if (/resolving deltas/i.test(text)) {
    return { percent: clampClonePercent(mapClonePhaseProgress(phasePercent, 75, 90)), message: "解析变更" };
  }
  if (/updating files|checking out files/i.test(text)) {
    return { percent: clampClonePercent(mapClonePhaseProgress(phasePercent, 90, 99)), message: "写入文件" };
  }

  return null;
}

function createGitCloneProgressHandler(onProgress?: (progress: CloneProjectProgress) => void): (chunk: string) => void {
  let pending = "";
  let lastPercent = 0;
  let lastMessage = "";

  function emit(progress: CloneProjectProgress): void {
    const percent = clampClonePercent(progress.percent);
    const message = progress.message;
    if (percent < lastPercent) return;
    if (percent === lastPercent && message === lastMessage) return;
    lastPercent = percent;
    lastMessage = message;
    onProgress?.({ percent: Math.min(percent, 99), message });
  }

  return (chunk: string) => {
    pending += chunk;
    const parts = pending.split(/\r|\n/);
    pending = parts.pop() || "";
    for (const part of parts) {
      const progress = parseGitCloneProgressLine(part);
      if (progress) emit(progress);
    }

    const progress = parseGitCloneProgressLine(pending);
    if (progress) emit(progress);
  };
}

function createAskpassScript(): { path: string; dir: string; markerPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anybot-git-askpass-"));
  const scriptPath = path.join(dir, process.platform === "win32" ? "askpass.cmd" : "askpass.sh");
  const markerPath = path.join(dir, "used");
  const content = process.platform === "win32"
    ? [
        "@echo off",
        "echo %~1 | findstr /I \"Username\" >nul",
        "if not errorlevel 1 (",
        "  echo username>>\"%ANYBOT_GIT_ASKPASS_MARKER%\"",
        "  <nul set /p \"=%ANYBOT_GIT_USERNAME%\"",
        "  echo(",
        "  exit /b 0",
        ")",
        "echo %~1 | findstr /I \"Password\" >nul",
        "if not errorlevel 1 (",
        "  echo password>>\"%ANYBOT_GIT_ASKPASS_MARKER%\"",
        "  <nul set /p \"=%ANYBOT_GIT_PASSWORD%\"",
        "  echo(",
        "  exit /b 0",
        ")",
        "echo(",
      ].join("\r\n")
    : [
        "#!/bin/sh",
        "case \"$1\" in",
        "  *Username*) printf 'username\\n' >> \"$ANYBOT_GIT_ASKPASS_MARKER\"; printf '%s\\n' \"$ANYBOT_GIT_USERNAME\" ;;",
        "  *Password*) printf 'password\\n' >> \"$ANYBOT_GIT_ASKPASS_MARKER\"; printf '%s\\n' \"$ANYBOT_GIT_PASSWORD\" ;;",
        "  *) printf '\\n' ;;",
        "esac",
      ].join("\n");
  fs.writeFileSync(scriptPath, content, { mode: 0o700 });
  return { path: scriptPath, dir, markerPath };
}

function buildCloneEnv(urlInfo: GitUrlInfo): { env: NodeJS.ProcessEnv; askpassDir?: string; askpassMarkerPath?: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  };

  if (urlInfo.protocol === "ssh") {
    if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
    return { env };
  }

  if (urlInfo.username && urlInfo.password) {
    const askpass = createAskpassScript();
    env.GIT_ASKPASS = askpass.path;
    env.ANYBOT_GIT_ASKPASS_MARKER = askpass.markerPath;
    env.ANYBOT_GIT_USERNAME = urlInfo.username || getDefaultHttpsGitUsername(urlInfo);
    env.ANYBOT_GIT_PASSWORD = urlInfo.password;
    return { env, askpassDir: askpass.dir, askpassMarkerPath: askpass.markerPath };
  }

  if (urlInfo.protocol === "https" && urlInfo.password) {
    const askpass = createAskpassScript();
    env.GIT_ASKPASS = askpass.path;
    env.ANYBOT_GIT_ASKPASS_MARKER = askpass.markerPath;
    env.ANYBOT_GIT_USERNAME = getDefaultHttpsGitUsername(urlInfo);
    env.ANYBOT_GIT_PASSWORD = urlInfo.password;
    return { env, askpassDir: askpass.dir, askpassMarkerPath: askpass.markerPath };
  }

  return { env };
}

function didGitRequestAskpassPassword(markerPath?: string): boolean {
  if (!markerPath) return false;
  try {
    if (!fs.existsSync(markerPath)) return false;
    return fs.readFileSync(markerPath, "utf-8").split(/\r?\n/).includes("password");
  } catch (error) {
    logger.warn("projects.git_askpass_marker_read_failed", { markerPath, error });
    return false;
  }
}

function buildGitCloneArgs(urlInfo: GitUrlInfo, targetPath: string): string[] {
  const args = ["clone", "--progress", urlInfo.cloneUrl, targetPath];
  if (urlInfo.protocol === "https" && urlInfo.password) {
    return ["-c", "credential.helper=", ...args];
  }
  return args;
}

function getGitErrorOutput(error: unknown): string {
  if (error instanceof GitCommandError) {
    return `${error.stderr}\n${error.stdout}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "");
}

function sanitizeGitOutput(value: string, rawUrl: string): string {
  let output = value.replace(/https?:\/\/[^/\s:@]+:[^@\s/]+@/gi, (match) => {
    const protocol = match.startsWith("https://") ? "https://" : "http://";
    return protocol;
  });
  if (rawUrl) {
    output = output.split(rawUrl).join("[Git 地址]");
  }
  return output.trim();
}

function summarizeGitError(error: unknown, urlInfo: GitUrlInfo): string {
  const rawOutput = getGitErrorOutput(error);
  const output = sanitizeGitOutput(rawOutput, urlInfo.rawUrl);
  const lower = output.toLowerCase();
  const summary = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-4).join("\n");

  if ((error as NodeJS.ErrnoException)?.code === "ENOENT" || lower.includes("spawn git enoent")) {
    return "未找到 git，请先安装 Git。";
  }

  if (urlInfo.protocol === "ssh" && (
    lower.includes("permission denied") ||
    lower.includes("publickey") ||
    lower.includes("could not read from remote repository") ||
    lower.includes("host key verification failed")
  )) {
    return `SSH 克隆失败，请确认本机已配置 SSH Key，并且当前账号有仓库访问权限。${summary ? "\n" + summary : ""}`;
  }

  if (urlInfo.protocol === "https" && (
    lower.includes("authentication failed") ||
    lower.includes("could not read username") ||
    lower.includes("terminal prompts disabled") ||
    lower.includes("invalid username or password") ||
    lower.includes("http basic: access denied")
  )) {
    return "HTTPS 认证失败，请检查密码或令牌";
  }

  if (
    lower.includes("could not resolve host") ||
    lower.includes("could not resolve hostname") ||
    lower.includes("failed to connect") ||
    lower.includes("network is unreachable")
  ) {
    return `网络连接失败，请检查 Git 地址和网络连接。${summary ? "\n" + summary : ""}`;
  }

  return `克隆仓库失败。${summary ? "\n" + summary : ""}`;
}

function logGitCloneFailure(error: unknown, urlInfo: GitUrlInfo, targetPath: string): void {
  const output = sanitizeGitOutput(getGitErrorOutput(error), urlInfo.rawUrl);
  logger.error("projects.git_clone_failed", {
    protocol: urlInfo.protocol,
    host: urlInfo.credentialHost,
    targetPath,
    output,
  });
}

async function rememberHttpsCredential(urlInfo: GitUrlInfo, projectPath: string): Promise<void> {
  if (!urlInfo.credentialUrl || !urlInfo.password) return;

  try {
    await runGit(["config", "credential.useHttpPath", "true"], { cwd: projectPath });
  } catch (error) {
    logger.warn("projects.git_credential_use_http_path_failed", { projectPath, error });
  }

  const credentialPath = urlInfo.credentialUrl.pathname.replace(/^\/+/, "");
  const input = [
    "protocol=https",
    `host=${urlInfo.credentialUrl.host}`,
    ...(credentialPath ? [`path=${credentialPath}`] : []),
    `username=${urlInfo.username || getDefaultHttpsGitUsername(urlInfo)}`,
    `password=${urlInfo.password}`,
    "",
  ].join("\n") + "\n";

  try {
    await runGit(["credential", "approve"], {
      cwd: projectPath,
      input,
    });
  } catch (error) {
    logger.warn("projects.git_credential_approve_failed", { projectPath, host: urlInfo.credentialUrl.host, error });
  }
}

export async function cloneProjectFromGit(options: CloneProjectOptions): Promise<db.Project> {
  const parentPath = normalizeParentPath(options.parentPath);
  const projectName = normalizeProjectFolderName(options.projectName);
  const targetPath = path.join(parentPath, projectName);
  if (fs.existsSync(targetPath)) {
    throw new Error("目标目录已存在，请更换项目名或保存目录");
  }

  const urlInfo = normalizeGitUrl(options.url, options.username?.trim(), options.password || undefined);
  const effectiveUrlInfo = resolveSavedGitCredential(urlInfo);
  if (effectiveUrlInfo.username && !effectiveUrlInfo.password) {
    throw new Error("请输入密码");
  }

  const cloneEnv = buildCloneEnv(effectiveUrlInfo);
  const handleProgress = createGitCloneProgressHandler(options.onProgress);
  try {
    options.onProgress?.({ percent: 1, message: "连接仓库" });
    await runGit(buildGitCloneArgs(effectiveUrlInfo, targetPath), {
      env: cloneEnv.env,
      onStdout: handleProgress,
      onStderr: handleProgress,
    });
    options.onProgress?.({ percent: 99, message: "添加项目" });
    setDefaultGitSaveDirectory(parentPath);
    const shouldSaveCredential = didGitRequestAskpassPassword(cloneEnv.askpassMarkerPath);
    if (shouldSaveCredential && effectiveUrlInfo.credentialHost && effectiveUrlInfo.password) {
      saveGitCredentialByHost(effectiveUrlInfo.credentialHost, effectiveUrlInfo.username || "", effectiveUrlInfo.password);
    }
    if (shouldSaveCredential) {
      await rememberHttpsCredential(effectiveUrlInfo, targetPath);
    }
    const project = createOrTouchProject(targetPath);
    options.onProgress?.({ percent: 100, message: "完成" });
    return project;
  } catch (error) {
    logGitCloneFailure(error, effectiveUrlInfo, targetPath);
    if (fs.existsSync(targetPath)) {
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn("projects.git_clone_cleanup_failed", { targetPath, cleanupError });
      }
    }
    throw new Error(summarizeGitError(error, effectiveUrlInfo));
  } finally {
    if (cloneEnv.askpassDir) {
      try {
        fs.rmSync(cloneEnv.askpassDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn("projects.git_askpass_cleanup_failed", { dir: cloneEnv.askpassDir, cleanupError });
      }
    }
  }
}

export function deleteProject(projectId: string): boolean {
  const deleted = db.deleteProject(projectId);
  if (!deleted) return false;
  emitProjectsChanged(projectId, "project_deleted");
  emitSessionsChanged(undefined, "project_deleted");
  return true;
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

export async function pickProjectFolder(opts: { defaultPath?: string; prompt?: string } = {}): Promise<string | null> {
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

export function readProjectTree(project: db.Project, relativePath: string): Array<{
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

export function getSessionWorkdir(session: Pick<db.ChatSession, "projectId">): string {
  if (!session.projectId) return getWorkdir();
  const project = db.getProject(session.projectId);
  if (!project) {
    throw new Error("项目不存在");
  }
  return normalizeProjectPath(project.path);
}
