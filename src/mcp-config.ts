import path from "node:path";
import { readAppSettings, type McpServerSettings } from "./app-settings.js";
import { resolveExecutable } from "./utils/process.js";

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

export function getClaudeMcpServersConfig(): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getMcpServersMap())
    .filter((server) => server.enabled)
    .map((server) => [server.id, normalizeProviderMcpConfig(server)]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function formatCodexMcpServerKey(serverId: string): string {
  return CODEX_BARE_KEY_PATTERN.test(serverId) ? serverId : JSON.stringify(serverId);
}

export function getCodexMcpServersConfig(): Record<string, Record<string, unknown>> | undefined {
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
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
