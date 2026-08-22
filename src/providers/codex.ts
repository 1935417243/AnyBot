import {
  Codex,
  type CodexOptions,
  type Input,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "fs";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { ProviderCancelledError } from "./types.js";
import type {
  IProvider,
  ProviderCapabilities,
  ProviderModel,
  ProviderContextUsage,
  ProviderStreamEvent,
  RunOptions,
  RunResult,
} from "./types.js";
import { sanitizeAgentText } from "./claude-code-agent-events.js";
import { logger } from "../logger.js";
import { DEFAULT_SANDBOX } from "../sandbox-config.js";
import { DEFAULT_PROVIDER_TIMEOUT_MS, type CodexUpstreamFormat } from "../app-settings.js";
import { registerCodexAdapterStream } from "../codex-adapter-stream.js";
import { getCliExecutablePath } from "../cli-runtime/installer.js";
import { resolveExecutable } from "../utils/process.js";
import { getCodexHome, getCodexSkillsDir, getIsolatedCodexHome } from "../codex-config.js";
import { getCodexMcpServersConfig } from "../mcp-config.js";

export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider 执行超时（${Math.round(timeoutMs / 1000)}s）`);
    this.name = "ProviderTimeoutError";
  }
}

/** abort 后等待 SDK 事件流收尾的宽限时间；超过则强制判定超时，避免 for-await 永久挂起。 */
export const PROVIDER_HARD_ABORT_GRACE_MS = 15_000;

export class ProviderProcessError extends Error {
  constructor(exitCode: number | null, output: string) {
    const code = exitCode ?? "unknown";
    const preview = output.slice(0, 300);
    super(`Provider 进程异常退出（状态码 ${code}）：${preview}`);
    this.name = "ProviderProcessError";
  }
}

export class ProviderEmptyOutputError extends Error {
  constructor() {
    super("Provider 返回了空内容");
    this.name = "ProviderEmptyOutputError";
  }
}

export class ProviderParseError extends Error {
  constructor(stdout: string) {
    const preview = stdout.slice(0, 300);
    super(`无法从 Provider 输出中解析有效消息：${preview}`);
    this.name = "ProviderParseError";
  }
}

export class ProviderExecutableNotFoundError extends Error {
  constructor(providerName: string, bin: string) {
    super(`${providerName} 可执行文件未找到：${bin}。请检查可执行文件路径，或清空自定义路径使用随包 CLI。`);
    this.name = "ProviderExecutableNotFoundError";
  }
}

const DEFAULT_TIMEOUT_MS = DEFAULT_PROVIDER_TIMEOUT_MS;
const DEFAULT_CODEX_CONTEXT_WINDOW = 200000;
const CODEX_NPM_NAME = "@openai/codex";
const CODEX_BUNDLED_BIN_LABEL = "bundled Codex CLI";
const CODEX_DOWNLOADED_BIN_LABEL = "已下载的 Codex CLI";
const moduleRequire = createRequire(import.meta.url);

const CODEX_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.6-sol": 1_000_000,
  "gpt-5.6-terra": 1_000_000,
  "gpt-5.6-luna": 400_000,
  "gpt-5.4": 1_000_000,
  "gpt-5.4-mini": 400_000,
  "gpt-5.3-codex": 258_000,
  "gpt-5.2-codex": 258_000,
  "gpt-5.2": 258_000,
  "gpt-5.1": 128_000,
  "gpt-5.1-codex": 128_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8192,
  "o3": 200_000,
  "o3-mini": 200_000,
};

const CODEX_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

type StreamHandler = (event: ProviderStreamEvent) => void | Promise<void>;

type ToolState = {
  startedAt: number;
};

type ToolOutput = {
  stdout?: string;
  stderr?: string;
  text?: string;
};

type CodexTokenUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

type CodexTokenCountInfo = {
  total_token_usage?: CodexTokenUsage;
  last_token_usage?: CodexTokenUsage;
  model_context_window?: number;
};

type CodexTokenCountEvent = {
  type: "event_msg";
  payload?: {
    type?: string;
    info?: CodexTokenCountInfo;
  };
};

type CodexSkillsMapping = {
  sourceDir: string;
  runtimeDir: string;
  mode: "same-home" | "linked-entries" | "failed";
  linked: number;
  removedStale: number;
  error?: string;
};

export type CodexExecutableResolution = {
  /** downloaded = userData 下按需下载的二进制；bundled = 随包 node_modules；configured = 用户指定或 PATH */
  source: "bundled" | "configured" | "downloaded";
  bin: string;
  executablePath: string | null;
  codexPathOverride?: string;
};

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeFsPath(value: string): string {
  return path.resolve(value).normalize("NFC");
}

function isSamePath(left: string, right: string): boolean {
  return normalizeFsPath(left) === normalizeFsPath(right);
}

function isDirectoryLike(dir: string, entryName: string): boolean {
  const entryPath = path.join(dir, entryName);
  try {
    const stat = lstatSync(entryPath);
    if (stat.isDirectory()) return true;
    if (!stat.isSymbolicLink()) return false;
    return statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const parent = normalizeFsPath(parentDir);
  const child = normalizeFsPath(childPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function ensureCodexSkillsAvailableInHome(runtimeCodexHome: string): CodexSkillsMapping {
  const sourceDir = getCodexSkillsDir();
  const runtimeDir = path.join(runtimeCodexHome, "skills");

  if (isSamePath(getCodexHome(), runtimeCodexHome)) {
    return { sourceDir, runtimeDir, mode: "same-home", linked: 0, removedStale: 0 };
  }

  try {
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });

    const sourceEntries = readdirSync(sourceDir, { withFileTypes: true });
    const sourceNames = new Set<string>();
    let linked = 0;
    let removedStale = 0;

    for (const entry of sourceEntries) {
      if (entry.name.startsWith(".")) continue;
      if (!isDirectoryLike(sourceDir, entry.name)) continue;

      sourceNames.add(entry.name);
      const sourcePath = path.join(sourceDir, entry.name);
      const runtimePath = path.join(runtimeDir, entry.name);
      if (existsSync(runtimePath)) continue;

      symlinkSync(sourcePath, runtimePath, process.platform === "win32" ? "junction" : "dir");
      linked++;
    }

    const runtimeEntries = readdirSync(runtimeDir, { withFileTypes: true });
    for (const entry of runtimeEntries) {
      if (entry.name.startsWith(".") || sourceNames.has(entry.name)) continue;

      const runtimePath = path.join(runtimeDir, entry.name);
      let stat;
      try {
        stat = lstatSync(runtimePath);
      } catch {
        continue;
      }
      if (!stat.isSymbolicLink()) continue;

      const linkTarget = path.resolve(path.dirname(runtimePath), readlinkSync(runtimePath));
      if (!isPathInside(sourceDir, linkTarget)) continue;
      if (existsSync(linkTarget)) continue;

      rmSync(runtimePath, { force: true });
      removedStale++;
    }

    return { sourceDir, runtimeDir, mode: "linked-entries", linked, removedStale };
  } catch (err) {
    return {
      sourceDir,
      runtimeDir,
      mode: "failed",
      linked: 0,
      removedStale: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildCodexAdapterRunBaseUrl(baseUrl: string, runId: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/v1")) {
    return `${clean.slice(0, -3)}/runs/${encodeURIComponent(runId)}/v1`;
  }
  return `${clean}/runs/${encodeURIComponent(runId)}`;
}

function getCodexTargetTriple(): string | null {
  switch (process.platform) {
    case "linux":
    case "android":
      if (process.arch === "x64") return "x86_64-unknown-linux-musl";
      if (process.arch === "arm64") return "aarch64-unknown-linux-musl";
      return null;
    case "darwin":
      if (process.arch === "x64") return "x86_64-apple-darwin";
      if (process.arch === "arm64") return "aarch64-apple-darwin";
      return null;
    case "win32":
      if (process.arch === "x64") return "x86_64-pc-windows-msvc";
      if (process.arch === "arm64") return "aarch64-pc-windows-msvc";
      return null;
    default:
      return null;
  }
}

function canRun(filePath: string): boolean {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBundledCodexExecutable(): string | null {
  const targetTriple = getCodexTargetTriple();
  if (!targetTriple) return null;

  const platformPackage = CODEX_PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  if (!platformPackage) return null;

  try {
    const codexPackageJsonPath = moduleRequire.resolve(`${CODEX_NPM_NAME}/package.json`);
    const codexRequire = createRequire(codexPackageJsonPath);
    const platformPackageJsonPath = codexRequire.resolve(`${platformPackage}/package.json`);
    const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    const binaryPath = path.join(
      path.dirname(platformPackageJsonPath),
      "vendor",
      targetTriple,
      "bin",
      binaryName,
    );
    return canRun(binaryPath) ? binaryPath : null;
  } catch {
    return null;
  }
}

export function resolveCodexExecutable(bin?: string): CodexExecutableResolution {
  const configuredBin = cleanString(bin);
  const bundledExecutable = resolveBundledCodexExecutable();

  if (!configuredBin || configuredBin === "codex") {
    // 优先级：按需下载到 userData 的二进制 > 随包 node_modules（dev 场景）> PATH
    const downloadedExecutable = getCliExecutablePath("codex");
    if (downloadedExecutable) {
      return {
        source: "downloaded",
        bin: CODEX_DOWNLOADED_BIN_LABEL,
        executablePath: downloadedExecutable,
        codexPathOverride: downloadedExecutable,
      };
    }

    if (bundledExecutable) {
      return {
        source: "bundled",
        bin: CODEX_BUNDLED_BIN_LABEL,
        executablePath: bundledExecutable,
      };
    }

    const pathExecutable = resolveExecutable("codex");
    if (pathExecutable) {
      return {
        source: "configured",
        bin: "codex",
        executablePath: pathExecutable,
        codexPathOverride: pathExecutable,
      };
    }

    if (!configuredBin) {
      return {
        source: "bundled",
        bin: CODEX_BUNDLED_BIN_LABEL,
        executablePath: null,
        codexPathOverride: "codex",
      };
    }
  }

  const executablePath = resolveExecutable(configuredBin);
  return {
    source: "configured",
    bin: configuredBin,
    executablePath,
    codexPathOverride: executablePath || configuredBin,
  };
}

function buildInput(prompt: string, imagePaths: string[]): Input {
  if (imagePaths.length === 0) return prompt;

  return [
    { type: "text", text: prompt },
    ...imagePaths.map((imagePath) => ({
      type: "local_image" as const,
      path: imagePath,
    })),
  ];
}

function formatJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return sanitizeAgentText(JSON.stringify(value, null, 2));
  } catch {
    return sanitizeAgentText(value);
  }
}

function mapFileEvent(kind: "add" | "delete" | "update"): "add" | "unlink" | "change" {
  if (kind === "add") return "add";
  if (kind === "delete") return "unlink";
  return "change";
}

function summarizeItem(item: ThreadItem): string {
  switch (item.type) {
    case "command_execution":
      return item.command;
    case "file_change":
      return item.changes.map((change) => change.path).join(", ");
    case "mcp_tool_call":
      return `${item.server}/${item.tool}`;
    case "web_search":
      return item.query;
    default:
      return "";
  }
}

function buildToolName(item: ThreadItem): string {
  switch (item.type) {
    case "command_execution":
      return "Bash";
    case "file_change":
      return "Edit";
    case "mcp_tool_call":
      return item.tool;
    case "web_search":
      return "WebSearch";
    default:
      return item.type;
  }
}

function buildToolTitle(item: ThreadItem, summary: string): string {
  const name = buildToolName(item);
  return summary ? `${name} · ${summary}` : name;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getUsageNumber(usage: CodexTokenUsage | undefined, key: keyof CodexTokenUsage): number | undefined {
  return getNumber(usage?.[key]);
}

function parseContextWindowFromModelName(model: string | undefined): number | undefined {
  const match = model?.trim().match(/\[([0-9.]+)([kKmM])\]\s*$/);
  if (!match) return undefined;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const unit = match[2].toLowerCase();
  return Math.round(value * (unit === "m" ? 1_000_000 : 1_000));
}

function getCodexContextWindowForModel(model: string | undefined): number {
  const explicit = parseContextWindowFromModelName(model);
  if (explicit) return explicit;

  const normalized = model?.trim();
  if (!normalized) return DEFAULT_CODEX_CONTEXT_WINDOW;
  return CODEX_MODEL_CONTEXT_WINDOWS[normalized] || DEFAULT_CODEX_CONTEXT_WINDOW;
}

function calculateCodexUsedTokens(inputTokens: number | undefined, outputTokens: number | undefined): number {
  return (inputTokens || 0) + (outputTokens || 0);
}

function calculatePercentage(usedTokens: number, maxTokens: number): number {
  return Math.min(100, Math.round((usedTokens / maxTokens) * 1000) / 10);
}

function buildContextUsage(
  usedTokens: number,
  maxTokens: number,
  extras: Partial<
    Pick<
      ProviderContextUsage,
      "inputTokens" | "outputTokens" | "cacheCreationInputTokens" | "cacheReadInputTokens"
    >
  >,
): ProviderContextUsage | undefined {
  if (usedTokens <= 0 || maxTokens <= 0) return undefined;

  const usedPercentage = calculatePercentage(usedTokens, maxTokens);

  return {
    usedTokens,
    maxTokens,
    usedPercentage,
    remainingPercentage: Math.max(0, Math.round((100 - usedPercentage) * 10) / 10),
    ...extras,
    source: "codex",
  };
}

function isCodexTokenCountEvent(event: unknown): event is CodexTokenCountEvent {
  if (!event || typeof event !== "object") return false;
  const record = event as Record<string, unknown>;
  if (record.type !== "event_msg") return false;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") return false;
  return (payload as Record<string, unknown>).type === "token_count";
}

async function findCodexSessionFile(sessionId: string, codexHomeOverride?: string): Promise<string | null> {
  const codexHome = codexHomeOverride || getCodexHome();
  const sessionsDir = path.join(codexHome, "sessions");
  const stack = [sessionsDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries: Array<import("fs").Dirent>;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`)) {
        return entryPath;
      }
    }
  }

  return null;
}

async function readLatestCodexTokenCountInfo(
  sessionId: string | null,
  codexHomeOverride?: string,
): Promise<CodexTokenCountInfo | null> {
  if (!sessionId) return null;

  const sessionFile = await findCodexSessionFile(sessionId, codexHomeOverride);
  if (!sessionFile) return null;

  let content: string;
  try {
    content = await fs.readFile(sessionFile, "utf8");
  } catch {
    return null;
  }

  let latest: CodexTokenCountInfo | null = null;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isCodexTokenCountEvent(event)) {
        latest = event.payload?.info || null;
      }
    } catch {
      continue;
    }
  }

  return latest;
}

function extractToolOutput(item: ThreadItem): ToolOutput | undefined {
  switch (item.type) {
    case "command_execution":
      return item.aggregated_output
        ? { stdout: sanitizeAgentText(item.aggregated_output) }
        : undefined;
    case "mcp_tool_call": {
      if (item.error?.message) return { stderr: sanitizeAgentText(item.error.message) };
      const content = item.result?.content
        ?.map((entry) => {
          if ("text" in entry && typeof entry.text === "string") return entry.text;
          return formatJson(entry);
        })
        .filter(Boolean)
        .join("\n");
      return content ? { text: sanitizeAgentText(content) } : undefined;
    }
    case "error":
      return { stderr: sanitizeAgentText(item.message) };
    default:
      return undefined;
  }
}

function itemStatus(item: ThreadItem): "running" | "success" | "failed" {
  switch (item.type) {
    case "command_execution":
      if (item.status === "failed") return "failed";
      if (item.status === "completed") return item.exit_code === 0 ? "success" : "failed";
      return "running";
    case "file_change":
      return item.status === "failed" ? "failed" : item.status === "completed" ? "success" : "running";
    case "mcp_tool_call":
      if (item.status === "failed") return "failed";
      return item.status === "completed" ? "success" : "running";
    default:
      return "success";
  }
}

function extractContextUsageFromTokenCount(
  info: CodexTokenCountInfo | null,
): ProviderContextUsage | undefined {
  if (!info) return undefined;

  const maxTokens = getNumber(info.model_context_window);
  if (!maxTokens) return undefined;

  const usage = info.total_token_usage || info.last_token_usage;
  if (!usage) return undefined;

  const inputTokens = getUsageNumber(usage, "input_tokens");
  const outputTokens = getUsageNumber(usage, "output_tokens");
  const usedTokens = calculateCodexUsedTokens(inputTokens, outputTokens);
  if (!usedTokens) return undefined;

  return buildContextUsage(usedTokens, maxTokens, {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: getUsageNumber(usage, "cached_input_tokens"),
  });
}

function extractContextUsage(
  usage: Usage | null,
  tokenCountInfo: CodexTokenCountInfo | null,
  model?: string,
): ProviderContextUsage | undefined {
  const tokenCountUsage = extractContextUsageFromTokenCount(tokenCountInfo);
  if (tokenCountUsage) return tokenCountUsage;

  if (!usage) return undefined;
  return buildContextUsage(
    calculateCodexUsedTokens(usage.input_tokens, usage.output_tokens),
    getCodexContextWindowForModel(model),
    {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens: usage.cached_input_tokens,
    },
  );
}

export async function readLatestCodexContextUsage(
  sessionId: string | null,
): Promise<ProviderContextUsage | undefined> {
  if (!sessionId) return undefined;

  const homes = [getIsolatedCodexHome(), getCodexHome()];
  const uniqueHomes = Array.from(new Set(homes));

  for (const codexHome of uniqueHomes) {
    const info = await readLatestCodexTokenCountInfo(sessionId, codexHome);
    const usage = extractContextUsageFromTokenCount(info);
    if (usage) return usage;
  }

  return undefined;
}

function isToolItem(item: ThreadItem): boolean {
  return (
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "mcp_tool_call" ||
    item.type === "web_search"
  );
}

export class CodexProvider implements IProvider {
  readonly type = "codex";
  readonly displayName = "Codex CLI";
  readonly capabilities: ProviderCapabilities = {
    sessionResume: true,
    imageInput: true,
    sandbox: true,
  };

  private readonly bin: string;
  private readonly executablePath: string | null;
  private readonly codexPathOverride: string | undefined;
  private readonly timeoutMs: number;
  private readonly codex: Codex;
  private readonly codexHome: string | undefined;
  private readonly codexCompatEnabled: boolean;
  /** 上游协议格式：responses 由 Codex 直连上游；anthropic 经本地适配层翻译 */
  private readonly codexUpstreamFormat: CodexUpstreamFormat;
  private readonly codexAdapterBaseUrl: string | undefined;
  private readonly codexAnthropicBaseUrl: string | undefined;
  /** responses 直连模式下上游服务的真实 API Key */
  private readonly codexApiKey: string | undefined;
  private readonly codexDefaultModel: string | undefined;
  private readonly codexFastModel: string | undefined;
  private readonly codexCodeModel: string | undefined;

  constructor(opts?: {
    bin?: string;
    timeoutMs?: number;
    codexCompatEnabled?: boolean;
    codexUpstreamFormat?: CodexUpstreamFormat;
    codexAdapterBaseUrl?: string;
    codexAnthropicBaseUrl?: string;
    codexApiKey?: string;
    codexDefaultModel?: string;
    codexFastModel?: string;
    codexCodeModel?: string;
  }) {
    const executable = resolveCodexExecutable(opts?.bin);
    const codexOptions: CodexOptions = executable.codexPathOverride
      ? { codexPathOverride: executable.codexPathOverride }
      : {};
    this.codexCompatEnabled = opts?.codexCompatEnabled === true;
    this.codexUpstreamFormat = opts?.codexUpstreamFormat === "anthropic" ? "anthropic" : "responses";
    this.codexAdapterBaseUrl = cleanString(opts?.codexAdapterBaseUrl);
    this.codexAnthropicBaseUrl = cleanString(opts?.codexAnthropicBaseUrl);
    this.codexApiKey = cleanString(opts?.codexApiKey);
    this.codexDefaultModel = cleanString(opts?.codexDefaultModel);
    this.codexFastModel = cleanString(opts?.codexFastModel);
    this.codexCodeModel = cleanString(opts?.codexCodeModel);
    const activeBaseUrl = this.getActiveUpstreamBaseUrl();
    if (this.codexCompatEnabled && activeBaseUrl) {
      this.codexHome = getIsolatedCodexHome();
      Object.assign(codexOptions, this.buildCompatCodexOptions());
    }
    codexOptions.config = this.buildCodexConfig(activeBaseUrl, false);
    this.bin = executable.bin;
    this.executablePath = executable.executablePath;
    this.codexPathOverride = executable.codexPathOverride;
    this.timeoutMs = opts?.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.codex = new Codex(codexOptions);
  }

  /** compat 模式下 Codex 实际请求的上游地址：responses 直连上游；anthropic 指向本地适配层 */
  private getActiveUpstreamBaseUrl(): string | undefined {
    if (!this.codexCompatEnabled) return undefined;
    return this.codexUpstreamFormat === "responses"
      ? this.codexAnthropicBaseUrl
      : this.codexAdapterBaseUrl;
  }

  /** compat 模式下 Codex SDK 的基础选项（隔离 env + 上游地址与密钥），构造函数与 per-run 实例共用 */
  private buildCompatCodexOptions(): Pick<CodexOptions, "env" | "apiKey" | "baseUrl"> {
    const env = this.buildIsolatedCodexEnv();
    if (this.codexUpstreamFormat === "responses") {
      return {
        env,
        apiKey: this.codexApiKey || "anybot-codex-responses",
        baseUrl: this.codexAnthropicBaseUrl,
      };
    }
    return {
      env,
      apiKey: "anybot-local-codex-adapter",
      baseUrl: this.codexAdapterBaseUrl,
    };
  }

  listModels(): ProviderModel[] {
    if (this.codexCompatEnabled) {
      return [
        { id: "gpt-5.6-sol", name: this.codexDefaultModel || "gpt-5.6-sol", description: "默认通用模型" },
        { id: "gpt-mini", name: this.codexFastModel || this.codexDefaultModel || "gpt-mini", description: "轻量快速模型" },
        { id: "gpt-codex", name: this.codexCodeModel || this.codexDefaultModel || "gpt-codex", description: "编程模型" },
      ];
    }

    return [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", description: "最新通用模型" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", description: "通用模型" },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", description: "轻量快速模型" },
    ];
  }

  private resolveContextModel(model: string | undefined): string | undefined {
    const requested = cleanString(model);
    if (!this.codexCompatEnabled) return requested;

    if (requested?.includes("mini")) {
      return this.codexFastModel || this.codexDefaultModel || requested;
    }
    if (requested?.includes("codex")) {
      return this.codexCodeModel || this.codexDefaultModel || requested;
    }
    return this.codexDefaultModel || requested;
  }

  /** 传给 Codex 的模型：responses 直连需映射为上游真实模型名；anthropic 模式传虚拟 id，由适配层映射 */
  private resolveThreadModel(model: string | undefined): string | undefined {
    if (this.codexCompatEnabled && this.codexUpstreamFormat === "responses") {
      return this.resolveContextModel(model);
    }
    return cleanString(model);
  }

  async run(opts: RunOptions): Promise<RunResult> {
    return this.execute(opts);
  }

  async runWithEvents(
    opts: RunOptions & {
      onEvent: StreamHandler;
    },
  ): Promise<RunResult> {
    return this.execute(opts, opts.onEvent);
  }

  private async execute(opts: RunOptions, onEvent?: StreamHandler): Promise<RunResult> {
    const {
      workdir,
      prompt,
      model,
      effort,
      imagePaths = [],
      sessionId,
      timeoutMs = this.timeoutMs,
      signal,
    } = opts;
    const sandbox = opts.sandbox ?? process.env.CODEX_SANDBOX ?? DEFAULT_SANDBOX;
    const startedAt = Date.now();
    const abortController = new AbortController();
    const toolStateById = new Map<string, ToolState>();
    const textByAgentMessageId = new Map<string, string>();
    /** reasoning item 已推送文本，用于 item.updated 增量切片，避免重复输出 */
    const textByReasoningId = new Map<string, string>();
    const codexSkillsMapping = this.codexHome
      ? ensureCodexSkillsAvailableInHome(this.codexHome)
      : null;
    const mcpServers = getCodexMcpServersConfig();
    let hardExpired = false;
    // 硬超时兜底触发后丢弃后台残留事件，避免 turn 已失败返回后仍向会话推流
    const emitEvent: typeof onEvent = onEvent
      ? (event) => (hardExpired ? undefined : onEvent(event))
      : undefined;
    // 适配层旁路推流只在 anthropic 格式下存在；responses 直连由 Codex SDK 原生 item 事件流式输出
    const adapterRunId = onEvent && this.codexCompatEnabled && this.codexUpstreamFormat === "anthropic" && this.codexAdapterBaseUrl
      ? randomUUID()
      : undefined;
    let adapterAnswerStreamed = false;
    const unregisterAdapterStream = adapterRunId && onEvent
      ? registerCodexAdapterStream(adapterRunId, (event) => {
          if (event.type === "answer_delta" && event.text) {
            adapterAnswerStreamed = true;
          }
          return emitEvent?.(event);
        })
      : undefined;

    let timedOut = false;
    let providerSessionId = sessionId || null;
    let responseText = "";
    let usage: Usage | null = null;
    let tokenCountInfo: CodexTokenCountInfo | null = null;
    let answerDoneEmitted = false;
    let earlyContextUsage: ProviderContextUsage | undefined;
    const contextModel = this.resolveContextModel(model);

    const buildCurrentContextUsage = (): ProviderContextUsage | undefined =>
      extractContextUsage(usage, tokenCountInfo, contextModel);

    const emitCodexAnswerDone = async (): Promise<ProviderContextUsage | undefined> => {
      if (!emitEvent || answerDoneEmitted) return undefined;

      const content = responseText.trim();
      if (!content) return undefined;

      const contextUsage = buildCurrentContextUsage();
      answerDoneEmitted = true;
      await emitEvent({
        type: "codex_answer_done",
        content,
        sessionId: providerSessionId,
        provider: "codex",
        durationMs: Date.now() - startedAt,
        contextUsage,
      });
      return contextUsage;
    };

    let hardTimer: NodeJS.Timeout | null = null;
    let rejectHardDeadline: (error: Error) => void = () => {};
    const hardDeadline = new Promise<never>((_resolve, reject) => {
      rejectHardDeadline = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      // abort 只是请求 SDK 停止；若事件流迟迟不结束，硬 deadline 强制让本次 turn 失败返回
      hardTimer = setTimeout(() => {
        hardExpired = true;
        rejectHardDeadline(new ProviderTimeoutError(timeoutMs));
      }, PROVIDER_HARD_ABORT_GRACE_MS);
    }, timeoutMs);
    const abortFromSignal = () => abortController.abort(signal?.reason);
    if (signal?.aborted) {
      abortFromSignal();
    } else {
      signal?.addEventListener("abort", abortFromSignal, { once: true });
    }

    logger.info("provider.exec.start", {
      provider: this.type,
      bin: this.bin,
      executablePath: this.executablePath,
      codexHome: this.codexHome || getCodexHome(),
      codexSkillsDir: codexSkillsMapping?.sourceDir || getCodexSkillsDir(),
      codexRuntimeSkillsDir: codexSkillsMapping?.runtimeDir || null,
      codexSkillsMapping: codexSkillsMapping?.mode || null,
      codexSkillsLinked: codexSkillsMapping?.linked || 0,
      codexSkillsRemovedStale: codexSkillsMapping?.removedStale || 0,
      codexSkillsMappingError: codexSkillsMapping?.error || null,
      mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
      workdir,
      sandbox,
      model: model || null,
      sessionId: sessionId || null,
      imageCount: imagePaths.length,
      promptChars: prompt.length,
      timeoutMs,
    });

    try {
      if (this.codexPathOverride && !this.executablePath) {
        throw new ProviderExecutableNotFoundError("Codex CLI", this.bin);
      }

      await emitEvent?.({
        type: "agent_status",
        status: "started",
        message: "Codex Agent 已启动",
      });

      // max / ultracode 是 AnyBot 的 UI 档位，Codex 最高只到 xhigh
      const codexEffort = effort === "max" || effort === "ultracode" ? "xhigh" : effort;
      const threadOptions: ThreadOptions = {
        workingDirectory: workdir,
        skipGitRepoCheck: true,
        sandboxMode: sandbox as ThreadOptions["sandboxMode"],
        model: this.resolveThreadModel(model),
        modelReasoningEffort: codexEffort as ThreadOptions["modelReasoningEffort"],
      };
      const codex = this.createCodexForRun(adapterRunId);
      const thread = sessionId
        ? codex.resumeThread(sessionId, threadOptions)
        : codex.startThread(threadOptions);
      const { events } = await thread.runStreamed(buildInput(prompt, imagePaths), {
        signal: abortController.signal,
      });

      const consuming = (async () => {
        for await (const event of events) {
          // Codex CLI can emit token_count records that are not part of the SDK's typed event union.
          const rawEvent: unknown = event;
          if (isCodexTokenCountEvent(rawEvent)) {
            tokenCountInfo = rawEvent.payload?.info || null;
          }

          if (event.type === "thread.started") {
            providerSessionId = event.thread_id;
          } else if (event.type === "turn.started") {
            await emitEvent?.({
              type: "agent_status",
              status: "running",
              message: "Codex Agent 正在处理",
            });
          } else if (event.type === "turn.completed") {
            usage = event.usage;
            earlyContextUsage = (await emitCodexAnswerDone()) || earlyContextUsage;
          } else if (event.type === "turn.failed") {
            throw new ProviderProcessError(1, event.error.message);
          } else if (event.type === "error") {
            throw new ProviderProcessError(1, event.message);
          }

          if ("item" in event) {
            const text = await this.handleItemEvent(
              event,
              toolStateById,
              textByAgentMessageId,
              textByReasoningId,
              emitEvent,
              adapterAnswerStreamed,
            );
            if (text !== null) responseText = text;
          }
        }
      })();
      // SDK 忽略 abort 时 for-await 可能永不结束；硬 deadline 强制 reject，由后台残留的 consuming 自行收尾
      consuming.catch(() => {});
      await Promise.race([consuming, hardDeadline]);

      clearTimeout(timer);

      if (timedOut) {
        throw new ProviderTimeoutError(timeoutMs);
      }

      const finalText = responseText.trim();
      if (!finalText) {
        logger.error("provider.exec.empty_response", {
          provider: this.type,
          workdir,
          sandbox,
          durationMs: Date.now() - startedAt,
          sessionId: providerSessionId,
        });
        throw new ProviderEmptyOutputError();
      }

      let contextUsage = earlyContextUsage;
      tokenCountInfo = tokenCountInfo || (await readLatestCodexTokenCountInfo(providerSessionId, this.codexHome));
      const finalContextUsage = buildCurrentContextUsage();
      if (onEvent) {
        contextUsage = finalContextUsage || contextUsage;
        contextUsage = (await emitCodexAnswerDone()) || contextUsage;
      } else {
        contextUsage = finalContextUsage;
      }

      logger.info("provider.exec.success", {
        provider: this.type,
        workdir,
        sandbox,
        durationMs: Date.now() - startedAt,
        replyChars: finalText.length,
        sessionId: providerSessionId,
        usage,
        tokenCountInfo,
      });

      await onEvent?.({
        type: "agent_status",
        status: "completed",
        message: "Codex Agent 已完成",
        sessionId: providerSessionId || undefined,
        durationMs: Date.now() - startedAt,
      });

      return {
        text: finalText,
        sessionId: providerSessionId,
        contextUsage,
      };
    } catch (error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromSignal);

      if (timedOut) {
        logger.warn("provider.exec.timeout", {
          provider: this.type,
          workdir,
          sandbox,
          durationMs: Date.now() - startedAt,
        });
        await onEvent?.({
          type: "agent_status",
          status: "failed",
          message: `Codex Agent 执行超时（${Math.round(timeoutMs / 1000)}s）`,
          durationMs: Date.now() - startedAt,
        });
        throw new ProviderTimeoutError(timeoutMs);
      }

      if (signal?.aborted) {
        logger.info("provider.exec.cancelled", {
          provider: this.type,
          workdir,
          sandbox,
          durationMs: Date.now() - startedAt,
          sessionId: providerSessionId,
        });
        await onEvent?.({
          type: "agent_status",
          status: "failed",
          message: "Codex Agent 已中断",
          durationMs: Date.now() - startedAt,
        });
        throw new ProviderCancelledError();
      }

      logger.error("provider.exec.error", {
        provider: this.type,
        workdir,
        sandbox,
        durationMs: Date.now() - startedAt,
        error,
      });
      await onEvent?.({
        type: "agent_status",
        status: "failed",
        message: error instanceof Error ? error.message : "Codex Agent 执行失败",
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      signal?.removeEventListener("abort", abortFromSignal);
      unregisterAdapterStream?.();
    }
  }

  private buildIsolatedCodexEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      env[key] = value;
    }
    if (this.codexHome) env.CODEX_HOME = this.codexHome;
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
    delete env.CODEX_API_KEY;
    return env;
  }

  private buildCodexConfig(
    baseUrl: string | undefined,
    includeMcpServers: boolean,
  ): CodexOptions["config"] | undefined {
    const config: Record<string, unknown> = {};
    if (this.codexCompatEnabled && baseUrl) {
      config.model_provider = "anybot";
      config.model_providers = {
        anybot: {
          name: "AnyBot Codex Adapter",
          base_url: baseUrl,
          wire_api: "responses",
        },
      };
      // responses 直连时请求上游返回推理摘要，否则 reasoning item 的 text 为空、前端看不到思考过程
      if (this.codexUpstreamFormat === "responses") {
        config.model_reasoning_summary = "detailed";
      }
    }

    if (includeMcpServers) {
      const mcpServers = getCodexMcpServersConfig();
      if (mcpServers) config.mcp_servers = mcpServers;
    }

    return Object.keys(config).length > 0 ? config as CodexOptions["config"] : undefined;
  }

  /** 构造本次运行的 Codex 实例：仅 anthropic 格式有 per-run 适配层地址；无 per-run 地址且无 MCP 配置时复用共享实例 */
  private createCodexForRun(runId: string | undefined): Codex {
    const mcpServers = getCodexMcpServersConfig();
    const runBaseUrl =
      runId && this.codexCompatEnabled && this.codexUpstreamFormat === "anthropic" && this.codexAdapterBaseUrl
        ? buildCodexAdapterRunBaseUrl(this.codexAdapterBaseUrl, runId)
        : undefined;
    if (!runBaseUrl && !mcpServers) return this.codex;

    const codexOptions: CodexOptions = this.codexPathOverride
      ? { codexPathOverride: this.codexPathOverride }
      : {};
    const activeBaseUrl = this.getActiveUpstreamBaseUrl();
    if (this.codexCompatEnabled && activeBaseUrl) {
      Object.assign(codexOptions, this.buildCompatCodexOptions());
      if (runBaseUrl) codexOptions.baseUrl = runBaseUrl;
    }
    codexOptions.config = this.buildCodexConfig(runBaseUrl || activeBaseUrl, true);
    return new Codex(codexOptions);
  }

  private async handleItemEvent(
    event: Extract<ThreadEvent, { item: ThreadItem }>,
    toolStateById: Map<string, ToolState>,
    textByAgentMessageId: Map<string, string>,
    /** reasoning item 已推送文本，item.updated 时只补增量 */
    textByReasoningId: Map<string, string>,
    onEvent?: StreamHandler,
    suppressAgentMessageDelta?: boolean,
  ): Promise<string | null> {
    const { item } = event;

    if (item.type === "agent_message") {
      const previous = textByAgentMessageId.get(item.id) || "";
      const next = sanitizeAgentText(item.text || "");
      if (onEvent && !suppressAgentMessageDelta && next.length > previous.length) {
        await onEvent({ type: "answer_delta", text: next.slice(previous.length) });
      }
      textByAgentMessageId.set(item.id, next);
      return next;
    }

    if (item.type === "reasoning" && item.text) {
      const previous = textByReasoningId.get(item.id) || "";
      const next = sanitizeAgentText(item.text);
      if (next.length > previous.length) {
        await onEvent?.({ type: "process_delta", text: next.slice(previous.length) });
        textByReasoningId.set(item.id, next);
      }
      return null;
    }

    if (item.type === "todo_list" && event.type === "item.completed") {
      const summary = item.items
        .map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`)
        .join("\n");
      if (summary) await onEvent?.({ type: "process_delta", text: `${summary}\n` });
      return null;
    }

    if (!isToolItem(item)) {
      return null;
    }

    if (!toolStateById.has(item.id)) {
      const summary = sanitizeAgentText(summarizeItem(item));
      toolStateById.set(item.id, {
        startedAt: Date.now(),
      });
      await onEvent?.({
        type: "tool_start",
        tool: {
          id: item.id,
          name: buildToolName(item),
          title: sanitizeAgentText(buildToolTitle(item, summary)),
          summary,
          input: item.type === "mcp_tool_call" ? formatJson(item.arguments) : undefined,
          startedAt: Date.now(),
          status: "running",
        },
      });
    }

    if (item.type === "file_change" && event.type === "item.completed") {
      for (const change of item.changes) {
        await onEvent?.({
          type: "file_change",
          path: change.path,
          event: mapFileEvent(change.kind),
        });
      }
    }

    if (event.type !== "item.completed") {
      return null;
    }

    const state = toolStateById.get(item.id);
    const status = itemStatus(item);
    await onEvent?.({
      type: "tool_end",
      toolId: item.id,
      status: status === "running" ? "success" : status,
      durationMs: state ? Date.now() - state.startedAt : undefined,
      output: extractToolOutput(item),
      error:
        item.type === "mcp_tool_call" && item.error?.message
          ? sanitizeAgentText(item.error.message)
          : undefined,
      files: item.type === "file_change" ? item.changes.map((change) => change.path) : undefined,
    });

    return null;
  }
}
