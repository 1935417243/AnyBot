import path from "node:path";
import { readAppSettings, type McpServerSettings } from "./app-settings.js";
import type { AppMcpServerConnection } from "./providers/types.js";
import { resolveExecutable } from "./utils/process.js";

/** AnyBot 内置 MCP Server 在各 Provider 配置中的 Server 名称；与用户 MCP 同名时以内置为准 */
export const APP_MCP_SERVER_ID = "anybot";

/** AnyBot 内置 MCP Server 提供的全部工具名，用于 Claude Code / CodeBuddy 非完全访问模式的工具白名单 */
export const APP_MCP_TOOL_NAMES = [
  "automation_options",
  "automation_list",
  "automation_create",
  "automation_update",
  "automation_delete",
] as const;

const CODEX_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const WINDOWS_SCRIPT_EXTENSIONS = new Set([".cmd", ".bat"]);

export function getMcpServersMap(): Record<string, McpServerSettings> {
  return readAppSettings().mcp.servers || {};
}

function getServerEnv(config: Record<string, unknown>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!config.env || typeof config.env !== "object" || Array.isArray(config.env)) return env;
  for (const [key, value] of Object.entries(config.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function getServerArgs(config: Record<string, unknown>): string[] {
  return Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
}

function normalizeProviderMcpConfig(server: McpServerSettings): Record<string, unknown> {
  const config: Record<string, unknown> = { ...server.config };
  const command = typeof config.command === "string" ? config.command.trim() : "";
  if (process.platform !== "win32" || !command) return config;

  const resolvedCommand = resolveExecutable(command, getServerEnv(config)) || command;
  const extension = path.win32.extname(resolvedCommand).toLowerCase();
  if (!WINDOWS_SCRIPT_EXTENSIONS.has(extension)) return config;

  config.command = "cmd.exe";
  config.args = ["/d", "/c", resolvedCommand, ...getServerArgs(config)];
  return config;
}

export function getClaudeMcpServersConfig(
  appServer?: AppMcpServerConnection,
): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getMcpServersMap())
    .filter((server) => server.enabled)
    .map((server) => [server.id, normalizeProviderMcpConfig(server)]);
  if (appServer) {
    entries.push([APP_MCP_SERVER_ID, { type: "http", url: appServer.url, headers: appServer.headers }]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Claude Code / CodeBuddy 自带的会话级定时工具。AnyBot 每轮对话结束 CLI 进程就退出，这些任务基本不会触发，
 * 也不会出现在 AnyBot 自动化里；注入内置 MCP 时禁用它们，让 Agent 改用 automation_* 工具。
 */
const PROVIDER_BUILTIN_SCHEDULE_TOOLS = ["CronCreate", "CronDelete", "CronList"];

/** 注入内置 MCP 时需要对 Claude Code / CodeBuddy 禁用的自带工具；未注入时返回 undefined，保持原有行为 */
export function getAppMcpDisallowedTools(appServer?: AppMcpServerConnection): string[] | undefined {
  return appServer ? [...PROVIDER_BUILTIN_SCHEDULE_TOOLS] : undefined;
}

/** Claude Code / CodeBuddy 工具白名单中需要追加的内置 MCP 工具；未注入内置 Server 时为空 */
export function getAppMcpAllowedTools(appServer?: AppMcpServerConnection): string[] {
  if (!appServer) return [];
  return APP_MCP_TOOL_NAMES.map((name) => `mcp__${APP_MCP_SERVER_ID}__${name}`);
}

function formatCodexMcpServerKey(serverId: string): string {
  return CODEX_BARE_KEY_PATTERN.test(serverId) ? serverId : JSON.stringify(serverId);
}

export function getCodexMcpServersConfig(
  appServer?: AppMcpServerConnection,
): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getMcpServersMap())
    .filter((server) => server.enabled)
    .map((server) => {
      const config = normalizeProviderMcpConfig(server);
      if (config.headers && !config.http_headers) {
        config.http_headers = config.headers;
      }
      delete config.headers;
      delete config.type;
      return [formatCodexMcpServerKey(server.id), config];
    });
  if (appServer) {
    // Codex exec 无法交互确认工具调用，内置工具显式免审批，避免调用被自动拒绝
    entries.push([APP_MCP_SERVER_ID, {
      url: appServer.url,
      http_headers: appServer.headers,
      default_tools_approval_mode: "approve",
    }]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
