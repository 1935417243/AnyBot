import {
  Codex,
  type Input,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk";
import { accessSync, constants } from "fs";
import fs from "fs/promises";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { ProviderCancelledError } from "./types.js";
import type {
  IProvider,
  ProviderCapabilities,
  ProviderModel,
  ProviderContextUsage,
  RunOptions,
  RunResult,
} from "./types.js";
import {
  sanitizeAgentText,
  type ClaudeAgentStreamEvent,
} from "./claude-code-agent-events.js";
import { logger } from "../logger.js";
import { DEFAULT_SANDBOX } from "../sandbox-config.js";
import { resolveExecutable } from "../utils/process.js";

export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider 执行超时（${Math.round(timeoutMs / 1000)}s）`);
    this.name = "ProviderTimeoutError";
  }
}

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

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CODEX_CONTEXT_WINDOW = 258400;
const CODEX_NPM_NAME = "@openai/codex";
const CODEX_BUNDLED_BIN_LABEL = "bundled Codex CLI";
const moduleRequire = createRequire(import.meta.url);

const CODEX_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

type StreamHandler = (event: ClaudeAgentStreamEvent) => void | Promise<void>;

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

export type CodexExecutableResolution = {
  source: "bundled" | "configured";
  bin: string;
  executablePath: string | null;
  codexPathOverride?: string;
};

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
      "codex",
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

  const cappedUsedTokens = Math.min(usedTokens, maxTokens);
  const usedPercentage = calculatePercentage(cappedUsedTokens, maxTokens);

  return {
    usedTokens: cappedUsedTokens,
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

async function findCodexSessionFile(sessionId: string): Promise<string | null> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
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

async function readLatestCodexTokenCountInfo(sessionId: string | null): Promise<CodexTokenCountInfo | null> {
  if (!sessionId) return null;

  const sessionFile = await findCodexSessionFile(sessionId);
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

  const usage = info.last_token_usage || info.total_token_usage;
  if (!usage) return undefined;

  const usedTokens = getUsageNumber(usage, "total_tokens") || getUsageNumber(usage, "input_tokens");
  if (!usedTokens) return undefined;

  return buildContextUsage(usedTokens, maxTokens, {
    inputTokens: getUsageNumber(usage, "input_tokens"),
    outputTokens: getUsageNumber(usage, "output_tokens"),
    cacheReadInputTokens: getUsageNumber(usage, "cached_input_tokens"),
  });
}

function extractContextUsage(
  usage: Usage | null,
  tokenCountInfo: CodexTokenCountInfo | null,
): ProviderContextUsage | undefined {
  const tokenCountUsage = extractContextUsageFromTokenCount(tokenCountInfo);
  if (tokenCountUsage) return tokenCountUsage;

  if (!usage) return undefined;
  return buildContextUsage(usage.input_tokens, DEFAULT_CODEX_CONTEXT_WINDOW, {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cached_input_tokens,
  });
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
  private readonly codex: Codex;

  constructor(opts?: { bin?: string }) {
    const executable = resolveCodexExecutable(opts?.bin);
    const codexOptions = executable.codexPathOverride
      ? { codexPathOverride: executable.codexPathOverride }
      : {};
    this.bin = executable.bin;
    this.executablePath = executable.executablePath;
    this.codexPathOverride = executable.codexPathOverride;
    this.codex = new Codex(codexOptions);
  }

  listModels(): ProviderModel[] {
    return [
      { id: "gpt-5.5", name: "GPT-5.5", description: "最新通用模型" },
      { id: "gpt-5.4", name: "GPT-5.4", description: "通用模型" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "轻量快速模型" },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "编程模型" },
      { id: "gpt-5.2", name: "GPT-5.2", description: "稳定通用模型" },
    ];
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
      imagePaths = [],
      sessionId,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      signal,
    } = opts;
    const sandbox = opts.sandbox ?? process.env.CODEX_SANDBOX ?? DEFAULT_SANDBOX;
    const startedAt = Date.now();
    const abortController = new AbortController();
    const toolStateById = new Map<string, ToolState>();
    const textByAgentMessageId = new Map<string, string>();

    let timedOut = false;
    let providerSessionId = sessionId || null;
    let responseText = "";
    let usage: Usage | null = null;
    let tokenCountInfo: CodexTokenCountInfo | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
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

      await onEvent?.({
        type: "agent_status",
        status: "started",
        message: "Codex Agent 已启动",
      });

      const threadOptions: ThreadOptions = {
        workingDirectory: workdir,
        skipGitRepoCheck: true,
        sandboxMode: sandbox as ThreadOptions["sandboxMode"],
        model: model || undefined,
      };
      const thread = sessionId
        ? this.codex.resumeThread(sessionId, threadOptions)
        : this.codex.startThread(threadOptions);
      const { events } = await thread.runStreamed(buildInput(prompt, imagePaths), {
        signal: abortController.signal,
      });

      for await (const event of events) {
        // Codex CLI can emit token_count records that are not part of the SDK's typed event union.
        const rawEvent: unknown = event;
        if (isCodexTokenCountEvent(rawEvent)) {
          tokenCountInfo = rawEvent.payload?.info || null;
        }

        if (event.type === "thread.started") {
          providerSessionId = event.thread_id;
        } else if (event.type === "turn.started") {
          await onEvent?.({
            type: "agent_status",
            status: "running",
            message: "Codex Agent 正在处理",
          });
        } else if (event.type === "turn.completed") {
          usage = event.usage;
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
            onEvent,
          );
          if (text !== null) responseText = text;
        }
      }

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

      tokenCountInfo = tokenCountInfo || (await readLatestCodexTokenCountInfo(providerSessionId));
      const contextUsage = extractContextUsage(usage, tokenCountInfo);

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
      signal?.removeEventListener("abort", abortFromSignal);
    }
  }

  private async handleItemEvent(
    event: Extract<ThreadEvent, { item: ThreadItem }>,
    toolStateById: Map<string, ToolState>,
    textByAgentMessageId: Map<string, string>,
    onEvent?: StreamHandler,
  ): Promise<string | null> {
    const { item } = event;

    if (item.type === "agent_message") {
      const previous = textByAgentMessageId.get(item.id) || "";
      const next = sanitizeAgentText(item.text || "");
      if (onEvent && next.length > previous.length) {
        await onEvent({ type: "answer_delta", text: next.slice(previous.length) });
      }
      textByAgentMessageId.set(item.id, next);
      return event.type === "item.completed" ? next : null;
    }

    if (item.type === "reasoning" && item.text) {
      await onEvent?.({ type: "answer_delta", text: sanitizeAgentText(item.text) });
      return null;
    }

    if (item.type === "todo_list" && event.type === "item.completed") {
      const summary = item.items
        .map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`)
        .join("\n");
      if (summary) await onEvent?.({ type: "answer_delta", text: `${summary}\n` });
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
