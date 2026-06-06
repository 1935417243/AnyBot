import { readAppSettings, type McpServerSettings } from "./app-settings.js";

const CODEX_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export function getMcpServersMap(): Record<string, McpServerSettings> {
  return readAppSettings().mcp.servers || {};
}

export function getClaudeMcpServersConfig(): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getMcpServersMap())
    .filter((server) => server.enabled)
    .map((server) => [server.id, { ...server.config }]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function formatCodexMcpServerKey(serverId: string): string {
  return CODEX_BARE_KEY_PATTERN.test(serverId) ? serverId : JSON.stringify(serverId);
}

export function getCodexMcpServersConfig(): Record<string, Record<string, unknown>> | undefined {
  const entries = Object.values(getMcpServersMap())
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
