import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readAppSettings, writeAppSettings, type McpServerSettings } from "../../app-settings.js";
import { logger } from "../../logger.js";
import { killProcessTree, spawnCommand } from "../../utils/process.js";

export type McpServerRuntimeStatus = "not_started" | "starting" | "running" | "failed" | "disabled";
export type McpLogLevel = "info" | "warn" | "error" | "success";

export interface McpServerLogEntry {
  id: string;
  timestamp: string;
  level: McpLogLevel;
  message: string;
}

export interface McpServerPublicView {
  id: string;
  name: string;
  enabled: boolean;
  status: McpServerRuntimeStatus;
  error?: string;
  checkedAt?: string;
  createdAt: string;
  updatedAt: string;
  command?: string;
  url?: string;
  configJson: string;
}

interface ParsedMcpServer {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

interface RuntimeState {
  status: McpServerRuntimeStatus;
  error?: string;
  checkedAt?: string;
}

interface VerifyResult {
  ok: boolean;
  error?: string;
}

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_VERIFY_TIMEOUT_MS = 20_000;
const MCP_LIST_TOOLS_GRACE_MS = 1500;
const MAX_MCP_VERIFY_TIMEOUT_MS = 60_000;
const MAX_LOGS_PER_SERVER = 100;
const INVALID_SERVER_NAME_PATTERN = /[\u0000-\u001f\u007f]/;
const CODEX_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

const runtimeStateById = new Map<string, RuntimeState>();
const logsByServerId = new Map<string, McpServerLogEntry[]>();
let startupCheckPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function addLog(serverId: string, level: McpLogLevel, message: string): void {
  const logs = logsByServerId.get(serverId) || [];
  logs.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: nowIso(),
    level,
    message,
  });
  if (logs.length > MAX_LOGS_PER_SERVER) logs.splice(0, logs.length - MAX_LOGS_PER_SERVER);
  logsByServerId.set(serverId, logs);
}

function setRuntimeState(serverId: string, state: RuntimeState): void {
  runtimeStateById.set(serverId, state);
}

function getRuntimeState(server: McpServerSettings): RuntimeState {
  if (!server.enabled) return { status: "disabled" };
  return runtimeStateById.get(server.id) || { status: "not_started" };
}

function getServersMap(): Record<string, McpServerSettings> {
  return readAppSettings().mcp.servers || {};
}

function saveServersMap(servers: Record<string, McpServerSettings>): void {
  const settings = readAppSettings();
  writeAppSettings({
    ...settings,
    mcp: {
      servers,
    },
  });
}

function cloneServersMap(): Record<string, McpServerSettings> {
  return Object.fromEntries(
    Object.entries(getServersMap()).map(([id, server]) => [
      id,
      {
        ...server,
        config: { ...server.config },
      },
    ]),
  );
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function assertStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return value;
}

function assertStringMap(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const raw = assertPlainObject(value, label);
  const result: Record<string, string> = {};
  for (const [key, nested] of Object.entries(raw)) {
    if (typeof nested !== "string") {
      throw new Error(`${label}.${key} 必须是字符串`);
    }
    result[key] = nested;
  }
  return result;
}

function assertPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正数`);
  }
  return parsed;
}

function stripLineComments(jsonText: string): string {
  return jsonText
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function normalizeServerConfig(id: string, rawConfig: unknown): ParsedMcpServer {
  const raw = assertPlainObject(rawConfig, `MCP Server ${id}`);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const command = typeof raw.command === "string" ? raw.command.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
  const transport = type || (command ? "stdio" : url ? "http" : "stdio");

  if (!id) {
    throw new Error("MCP Server 名称不能为空");
  }
  if (INVALID_SERVER_NAME_PATTERN.test(id)) {
    throw new Error(`MCP Server 名称 ${id} 不能包含控制字符`);
  }
  if (command && url) {
    throw new Error(`MCP Server ${id} 不能同时配置 command 和 url`);
  }
  if (!["stdio", "http", "sse"].includes(transport)) {
    throw new Error(`MCP Server ${id} 的 type 只能是 stdio、http 或 sse`);
  }
  if (transport === "stdio" && !command) {
    throw new Error(`MCP Server ${id} 缺少 command`);
  }
  if ((transport === "http" || transport === "sse") && !url) {
    throw new Error(`MCP Server ${id} 缺少 url`);
  }

  const args = assertStringArray(raw.args, `MCP Server ${id}.args`);
  const env = assertStringMap(raw.env, `MCP Server ${id}.env`);
  const headers = assertStringMap(raw.headers, `MCP Server ${id}.headers`);
  const httpHeaders = assertStringMap(raw.http_headers, `MCP Server ${id}.http_headers`);
  const envHttpHeaders = assertStringMap(raw.env_http_headers, `MCP Server ${id}.env_http_headers`);
  const envVars = assertStringArray(raw.env_vars, `MCP Server ${id}.env_vars`);
  const enabledTools = assertStringArray(raw.enabled_tools, `MCP Server ${id}.enabled_tools`);
  const disabledTools = assertStringArray(raw.disabled_tools, `MCP Server ${id}.disabled_tools`);
  const startupTimeoutSec = assertPositiveNumber(raw.startup_timeout_sec, `MCP Server ${id}.startup_timeout_sec`);
  const toolTimeoutSec = assertPositiveNumber(raw.tool_timeout_sec, `MCP Server ${id}.tool_timeout_sec`);

  if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
    throw new Error(`MCP Server ${id}.cwd 必须是字符串`);
  }
  if (raw.bearer_token_env_var !== undefined && typeof raw.bearer_token_env_var !== "string") {
    throw new Error(`MCP Server ${id}.bearer_token_env_var 必须是字符串`);
  }

  const config: Record<string, unknown> = { ...raw };
  delete config.name;
  delete config.enabled;

  config.type = transport;
  if (command) config.command = command;
  if (url) config.url = url;
  if (args) config.args = args;
  if (env) config.env = env;
  if (headers) config.headers = headers;
  if (httpHeaders) config.http_headers = httpHeaders;
  if (envHttpHeaders) config.env_http_headers = envHttpHeaders;
  if (envVars) config.env_vars = envVars;
  if (enabledTools) config.enabled_tools = enabledTools;
  if (disabledTools) config.disabled_tools = disabledTools;
  if (startupTimeoutSec) config.startup_timeout_sec = startupTimeoutSec;
  if (toolTimeoutSec) config.tool_timeout_sec = toolTimeoutSec;

  return { id, name, config };
}

function parseManualMcpConfig(jsonText: string, allowMultiple: boolean): ParsedMcpServer[] {
  const cleaned = stripLineComments(jsonText || "").trim();
  if (!cleaned) throw new Error("配置 JSON 不能为空");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const raw = assertPlainObject(parsed, "配置 JSON");
  const rawServers = raw.mcpServers || raw.mcp_servers;
  if (rawServers !== undefined) {
    const serverMap = assertPlainObject(rawServers, "mcpServers");
    const entries = Object.entries(serverMap);
    if (entries.length === 0) throw new Error("mcpServers 至少需要包含一个 MCP Server");
    if (!allowMultiple && entries.length !== 1) throw new Error("编辑时只能配置一个 MCP Server");
    return entries.map(([id, config]) => normalizeServerConfig(id.trim(), config));
  }

  if (raw.command || raw.url) {
    if (!allowMultiple) {
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
      if (!id) throw new Error("编辑单个 MCP Server 时，请使用 mcpServers 包裹并保留 Server 名称");
    }
    const id = typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `mcp-server-${Date.now()}`;
    return [normalizeServerConfig(id, raw)];
  }

  throw new Error("无法识别配置格式，请提供 mcpServers 对象或包含 command/url 的单个 Server 配置");
}

function getServerConfigJson(server: McpServerSettings): string {
  return JSON.stringify({
    mcpServers: {
      [server.id]: {
        name: server.name,
        ...server.config,
      },
    },
  }, null, 2);
}

function toPublicServer(server: McpServerSettings): McpServerPublicView {
  const state = getRuntimeState(server);
  const command = typeof server.config.command === "string"
    ? [server.config.command, ...(Array.isArray(server.config.args) ? server.config.args : [])].join(" ")
    : undefined;
  const url = typeof server.config.url === "string" ? server.config.url : undefined;
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    status: state.status,
    error: state.error,
    checkedAt: state.checkedAt,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    command,
    url,
    configJson: getServerConfigJson(server),
  };
}

function getVerifyTimeoutMs(config: Record<string, unknown>): number {
  const seconds = typeof config.startup_timeout_sec === "number"
    ? config.startup_timeout_sec
    : MCP_VERIFY_TIMEOUT_MS / 1000;
  return Math.min(Math.max(1000, Math.round(seconds * 1000)), MAX_MCP_VERIFY_TIMEOUT_MS);
}

function getEnv(config: Record<string, unknown>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (config.env && typeof config.env === "object" && !Array.isArray(config.env)) {
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  return env;
}

function safeKill(child: ChildProcessWithoutNullStreams | null): void {
  if (!child) return;
  try {
    killProcessTree(child, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getJsonRpcErrorMessage(message: Record<string, unknown>): string | null {
  const error = message.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const rawMessage = (error as Record<string, unknown>).message;
  return typeof rawMessage === "string" ? rawMessage : JSON.stringify(error);
}

function getServerInfoText(message: Record<string, unknown>): string {
  const result = message.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const serverInfo = (result as Record<string, unknown>).serverInfo;
  if (!serverInfo || typeof serverInfo !== "object" || Array.isArray(serverInfo)) return "";
  const info = serverInfo as Record<string, unknown>;
  const name = typeof info.name === "string" ? info.name : "";
  const version = typeof info.version === "string" ? info.version : "";
  return [name, version].filter(Boolean).join(" ");
}

function getToolsCount(message: Record<string, unknown>): number | null {
  const result = message.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const tools = (result as Record<string, unknown>).tools;
  return Array.isArray(tools) ? tools.length : null;
}

function buildInitializeRequest(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "anybot",
        version: "0.1.0",
      },
    },
  }) + "\n";
}

function buildInitializedNotification(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }) + "\n";
}

function buildToolsListRequest(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }) + "\n";
}

async function verifyStdioServer(server: McpServerSettings): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const command = typeof server.config.command === "string" ? server.config.command : "";
    const args = Array.isArray(server.config.args) ? server.config.args.filter((arg): arg is string => typeof arg === "string") : [];
    const cwd = typeof server.config.cwd === "string" && server.config.cwd.trim() ? server.config.cwd : undefined;
    const timeoutMs = getVerifyTimeoutMs(server.config);
    let child: ChildProcessWithoutNullStreams | null = null;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let initialized = false;
    let resolved = false;
    let toolsGraceTimer: NodeJS.Timeout | null = null;

    const finish = (result: VerifyResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      if (toolsGraceTimer) clearTimeout(toolsGraceTimer);
      safeKill(child);
      resolve(result);
    };

    const timeoutTimer = setTimeout(() => {
      finish({ ok: false, error: `启动超时（${Math.round(timeoutMs / 1000)} 秒），请检查命令或增加 startup_timeout_sec` });
    }, timeoutMs);

    try {
      child = spawnCommand(command, args, {
        cwd,
        env: getEnv(server.config),
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
      if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-4000);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const message = parseJsonLine(line);
        if (!message) continue;
        const id = message.id;
        const jsonRpcError = getJsonRpcErrorMessage(message);
        if (id === 1) {
          if (jsonRpcError) {
            finish({ ok: false, error: `initialize 失败：${jsonRpcError}` });
            return;
          }
          initialized = true;
          const infoText = getServerInfoText(message);
          addLog(server.id, "success", infoText ? `initialize 成功：${infoText}` : "initialize 成功");
          child?.stdin.write(buildInitializedNotification());
          child?.stdin.write(buildToolsListRequest());
          toolsGraceTimer = setTimeout(() => {
            finish({ ok: true });
          }, MCP_LIST_TOOLS_GRACE_MS);
        } else if (id === 2) {
          if (jsonRpcError) {
            addLog(server.id, "warn", `工具列表获取失败：${jsonRpcError}`);
            finish({ ok: true });
            return;
          }
          const count = getToolsCount(message);
          if (count !== null) addLog(server.id, "success", `工具列表获取成功：${count} 个工具`);
          finish({ ok: true });
        }
      }
    });

    child.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });

    child.on("close", (code, signal) => {
      if (resolved) return;
      if (initialized) {
        finish({ ok: true });
        return;
      }
      const stderrPreview = stderrBuffer.trim();
      const suffix = stderrPreview ? `：${stderrPreview.slice(0, 600)}` : "";
      finish({ ok: false, error: `进程提前退出（code=${code ?? "null"}, signal=${signal ?? "null"}）${suffix}` });
    });

    child.stdin.write(buildInitializeRequest());
  });
}

function parseSseData(text: string): Record<string, unknown> | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const raw = trimmed.slice(5).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function getHttpHeaders(config: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  const addHeaders = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === "string") headers[key] = nested;
    }
  };

  addHeaders(config.headers);
  addHeaders(config.http_headers);

  if (config.env_http_headers && typeof config.env_http_headers === "object" && !Array.isArray(config.env_http_headers)) {
    for (const [headerName, envName] of Object.entries(config.env_http_headers)) {
      if (typeof envName !== "string") continue;
      const envValue = process.env[envName];
      if (envValue) headers[headerName] = envValue;
    }
  }

  if (typeof config.bearer_token_env_var === "string") {
    const token = process.env[config.bearer_token_env_var];
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function verifyHttpServer(server: McpServerSettings): Promise<VerifyResult> {
  const url = typeof server.config.url === "string" ? server.config.url : "";
  const timeoutMs = getVerifyTimeoutMs(server.config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...getHttpHeaders(server.config),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: buildInitializeRequest().trim(),
      signal: controller.signal,
    });
    const text = await response.text();
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }

    const parsed = parseSseData(text) || parseJsonLine(text);
    if (!parsed) return { ok: false, error: "initialize 响应不是有效 JSON" };
    const jsonRpcError = getJsonRpcErrorMessage(parsed);
    if (jsonRpcError) return { ok: false, error: `initialize 失败：${jsonRpcError}` };
    if (parsed.result) {
      const infoText = getServerInfoText(parsed);
      addLog(server.id, "success", infoText ? `HTTP initialize 成功：${infoText}` : "HTTP initialize 成功");
      return { ok: true };
    }
    return { ok: false, error: "initialize 响应缺少 result" };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: `启动超时（${Math.round(timeoutMs / 1000)} 秒）` };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function verifyMcpServer(server: McpServerSettings): Promise<VerifyResult> {
  if (!server.enabled) {
    setRuntimeState(server.id, { status: "disabled" });
    addLog(server.id, "info", "MCP Server 已禁用");
    return { ok: true };
  }

  setRuntimeState(server.id, { status: "starting", checkedAt: nowIso() });
  addLog(server.id, "info", "开始检查 MCP Server");
  const type = typeof server.config.type === "string" ? server.config.type : "";
  const result = type === "http" || type === "sse"
    ? await verifyHttpServer(server)
    : await verifyStdioServer(server);

  if (result.ok) {
    setRuntimeState(server.id, { status: "running", checkedAt: nowIso() });
    addLog(server.id, "success", "MCP Server 启动检查通过");
    logger.info("mcp.server.running", { id: server.id });
    return { ok: true };
  }

  const error = result.error || "启动失败";
  setRuntimeState(server.id, { status: "failed", error, checkedAt: nowIso() });
  addLog(server.id, "error", error);
  logger.warn("mcp.server.failed", { id: server.id, error });
  return { ok: false, error };
}

export function listMcpServers(): McpServerPublicView[] {
  return Object.values(getServersMap()).map(toPublicServer);
}

export function getMcpServerLogs(serverId: string): McpServerLogEntry[] {
  return [...(logsByServerId.get(serverId) || [])].sort((a, b) => {
    return Date.parse(b.timestamp) - Date.parse(a.timestamp);
  });
}

export async function refreshMcpServers(): Promise<McpServerPublicView[]> {
  for (const server of Object.values(getServersMap())) {
    try {
      await verifyMcpServer(server);
    } catch {
      // The failed state and log entry were already recorded per server.
    }
  }
  return listMcpServers();
}

export function startMcpServersOnStartup(): void {
  if (startupCheckPromise) return;

  const enabledServers = Object.values(getServersMap()).filter((server) => server.enabled);
  if (enabledServers.length === 0) return;

  logger.info("mcp.startup_check.started", { count: enabledServers.length });
  startupCheckPromise = (async () => {
    for (const server of enabledServers) {
      await verifyMcpServer(server);
    }
  })()
    .then(() => {
      logger.info("mcp.startup_check.completed", { count: enabledServers.length });
    })
    .catch((error) => {
      logger.warn("mcp.startup_check.failed", { error });
    })
    .finally(() => {
      startupCheckPromise = null;
    });
}

export async function addMcpServersFromJson(jsonText: string): Promise<McpServerPublicView[]> {
  const parsed = parseManualMcpConfig(jsonText, true);
  const servers = cloneServersMap();
  const now = nowIso();

  for (const server of parsed) {
    if (servers[server.id]) throw new Error(`MCP Server ${server.id} 已存在`);
  }

  const nextServers = parsed.map((server): McpServerSettings => ({
    id: server.id,
    name: server.name,
    enabled: true,
    config: server.config,
    createdAt: now,
    updatedAt: now,
  }));

  for (const server of nextServers) {
    servers[server.id] = server;
    addLog(server.id, "success", "MCP Server 已添加并启用");
  }
  saveServersMap(servers);
  for (const server of nextServers) {
    await verifyMcpServer(server);
  }
  return listMcpServers();
}

export async function updateMcpServerFromJson(serverId: string, jsonText: string): Promise<McpServerPublicView[]> {
  const servers = cloneServersMap();
  const existing = servers[serverId];
  if (!existing) throw new Error("MCP Server 不存在");

  const [parsed] = parseManualMcpConfig(jsonText, false);
  if (parsed.id !== serverId && servers[parsed.id]) {
    throw new Error(`MCP Server ${parsed.id} 已存在`);
  }

  const next: McpServerSettings = {
    ...existing,
    id: parsed.id,
    name: parsed.name,
    config: parsed.config,
    updatedAt: nowIso(),
  };
  if (parsed.id !== serverId) {
    delete servers[serverId];
    runtimeStateById.delete(serverId);
    logsByServerId.set(parsed.id, logsByServerId.get(serverId) || []);
    logsByServerId.delete(serverId);
  }
  servers[parsed.id] = next;
  addLog(parsed.id, "success", "MCP Server 配置已更新");
  saveServersMap(servers);
  await verifyMcpServer(next);
  return listMcpServers();
}

export async function setMcpServerEnabled(serverId: string, enabled: boolean): Promise<McpServerPublicView[]> {
  const servers = cloneServersMap();
  const existing = servers[serverId];
  if (!existing) throw new Error("MCP Server 不存在");
  const next = {
    ...existing,
    enabled,
    updatedAt: nowIso(),
  };
  servers[serverId] = next;
  saveServersMap(servers);

  if (!enabled) {
    setRuntimeState(serverId, { status: "disabled", checkedAt: nowIso() });
    addLog(serverId, "info", "MCP Server 已禁用");
    return listMcpServers();
  }

  const result = await verifyMcpServer(next);
  if (result.ok) addLog(serverId, "success", "MCP Server 已启用");
  return listMcpServers();
}

export async function restartMcpServer(serverId: string): Promise<McpServerPublicView[]> {
  const server = getServersMap()[serverId];
  if (!server) throw new Error("MCP Server 不存在");
  if (!server.enabled) throw new Error("MCP Server 已禁用，无法重启");
  addLog(serverId, "info", "正在重启 MCP Server");
  const result = await verifyMcpServer(server);
  if (result.ok) addLog(serverId, "success", "MCP Server 已重启");
  return listMcpServers();
}

export function deleteMcpServer(serverId: string): McpServerPublicView[] {
  const servers = cloneServersMap();
  if (!servers[serverId]) throw new Error("MCP Server 不存在");
  delete servers[serverId];
  runtimeStateById.delete(serverId);
  logsByServerId.delete(serverId);
  saveServersMap(servers);
  logger.info("mcp.server.deleted", { id: serverId });
  return listMcpServers();
}

export function getClaudeMcpServersConfig(): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getServersMap())
    .filter((server) => server.enabled)
    .map((server) => [server.id, { ...server.config }]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function formatCodexMcpServerKey(serverId: string): string {
  return CODEX_BARE_KEY_PATTERN.test(serverId) ? serverId : JSON.stringify(serverId);
}

export function getCodexMcpServersConfig(): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getServersMap())
    .filter((server) => server.enabled)
    .map((server) => {
      const config: Record<string, unknown> = { ...server.config };
      if (config.headers && !config.http_headers) {
        config.http_headers = config.headers;
      }
      delete config.headers;
      delete config.type;
      return [formatCodexMcpServerKey(server.id), config];
    });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
