import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.resolve(__dirname, "../.data");
const CONFIG_PATH = path.join(dataDir, "app-settings.json");
let cachedSettings: AppSettings | null = null;

export type AppLanguage = "auto" | "zh" | "en";
export type AppLogLevel = "debug" | "info" | "warn" | "error";
export type AppTheme = "light" | "dark" | "system";
/** Codex 上游协议格式：responses = OpenAI Responses API 直连；anthropic = 经本地适配层翻译成 Anthropic Messages API */
export type CodexUpstreamFormat = "responses" | "anthropic";

export interface AnthropicBaseUrlPreset {
  apiKey?: string;
  anthropicBaseUrl?: string;
  anthropicAutoModel?: string;
  defaultModel?: string;
  anthropicOpusModel?: string;
  anthropicSonnetModel?: string;
  anthropicHaikuModel?: string;
  claudeCodeSubagentModel?: string;
}

export interface CodexBaseUrlPreset {
  codexAnthropicBaseUrl?: string;
  codexApiKey?: string;
  codexDefaultModel?: string;
  codexFastModel?: string;
  codexCodeModel?: string;
}

export interface ProviderRuntimeSettings {
  bin?: string;
  maxTurns?: number;
  timeoutMs?: number;
  apiKey?: string;
  apiKeyHelper?: string;
  permissionMode?: string;
  defaultModel?: string;
  pathToClaudeCodeExecutable?: string;
  anthropicCompatEnabled?: boolean;
  anthropicBaseUrl?: string;
  anthropicAutoModel?: string;
  anthropicOpusModel?: string;
  anthropicSonnetModel?: string;
  anthropicHaikuModel?: string;
  claudeCodeSubagentModel?: string;
  anthropicBaseUrlPresets?: Record<string, AnthropicBaseUrlPreset>;
  codexCompatEnabled?: boolean;
  /** Codex 上游服务的 API 协议格式：responses 直连，anthropic 走本地适配层 */
  codexUpstreamFormat?: CodexUpstreamFormat;
  codexAnthropicBaseUrl?: string;
  codexApiKey?: string;
  codexDefaultModel?: string;
  codexFastModel?: string;
  codexCodeModel?: string;
  codexBaseUrlPresets?: Record<string, CodexBaseUrlPreset>;
}

export interface McpServerSettings {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  general: {
    theme: AppTheme;
    language: AppLanguage;
    fontSize: number;
    openAtLogin: boolean;
    openWindowOnStart: boolean;
    webPort: number;
  };
  providers: Record<string, ProviderRuntimeSettings>;
  mcp: {
    servers: Record<string, McpServerSettings>;
  };
  workspace: {
    defaultWorkdir: string;
  };
  permissions: {
    requireDangerousConfirmation: boolean;
  };
  privacy: {
    logLevel: AppLogLevel;
    logIncludeContent: boolean;
    logIncludePrompt: boolean;
    logRetentionDays: number;
  };
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PROVIDER_TIMEOUT_MS = 2_147_000_000;
const DESKTOP_DEFAULT_WORKDIR_NAME = "AnyBotData";
const WINDOWS_HOME_WORKDIR_NAME = "AnyBotWorkspace";
const WINDOWS_INSTALL_WORKDIR_NAME = "anybotworkspace";
const WORKSPACE_MEMORY_FILES = ["AGENTS.md", "MEMORY.md", "PROFILE.md"];

function isDesktopRuntime(): boolean {
  return process.env.ANYBOT_DESKTOP === "1";
}

function getDesktopUserDataDir(): string {
  return path.dirname(path.resolve(dataDir));
}

function getDefaultWorkdir(): string {
  if (!isDesktopRuntime()) return process.cwd();

  const installDir = process.env.ANYBOT_INSTALL_DIR?.trim();
  if (process.platform === "win32" && installDir) {
    const root = path.win32.parse(path.win32.resolve(installDir)).root;
    if (root.toLowerCase() === "c:\\") {
      return path.win32.join(os.homedir(), WINDOWS_HOME_WORKDIR_NAME);
    }
    return path.win32.join(root, WINDOWS_INSTALL_WORKDIR_NAME);
  }

  return path.join(os.homedir(), DESKTOP_DEFAULT_WORKDIR_NAME);
}

function createDefaultSettings(): AppSettings {
  return {
    general: {
      theme: "system",
      language: "auto",
      fontSize: 14,
      openAtLogin: false,
      openWindowOnStart: true,
      webPort: 19981,
    },
    providers: {},
    mcp: {
      servers: {},
    },
    workspace: {
      defaultWorkdir: getDefaultWorkdir(),
    },
    permissions: {
      requireDangerousConfirmation: true,
    },
    privacy: {
      logLevel: "info",
      logIncludeContent: false,
      logIncludePrompt: false,
      logRetentionDays: 3,
    },
  };
}

const DEFAULT_SETTINGS: AppSettings = createDefaultSettings();

function copyWorkspaceMemoryFiles(sourceDir: string, targetDir: string): void {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) return;

  for (const file of WORKSPACE_MEMORY_FILES) {
    const source = path.join(sourceDir, file);
    const target = path.join(targetDir, file);
    try {
      if (!existsSync(source) || existsSync(target)) continue;
      copyFileSync(source, target);
    } catch {
      // Best effort only; the user can still pick or edit the workspace from settings.
    }
  }
}

function ensureDesktopDefaultWorkdir(workdir: string): void {
  if (!isDesktopRuntime()) return;
  if (path.resolve(workdir) !== path.resolve(getDefaultWorkdir())) return;

  mkdirSync(workdir, { recursive: true });
  copyWorkspaceMemoryFiles(getDesktopUserDataDir(), workdir);
  copyWorkspaceMemoryFiles(path.join(__dirname, "agent", "md_files"), workdir);
}

function ensureConfig(): void {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    ensureDesktopDefaultWorkdir(DEFAULT_SETTINGS.workspace.defaultWorkdir);
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
  }
}

function isLanguage(value: unknown): value is AppLanguage {
  return value === "auto" || value === "zh" || value === "en";
}

function isLogLevel(value: unknown): value is AppLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isTheme(value: unknown): value is AppTheme {
  return value === "light" || value === "dark" || value === "system";
}

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 20;

function normalizeFontSize(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.general.fontSize;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.floor(parsed)));
}

function normalizeLogRetentionDays(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.floor(parsed);
  }
  return DEFAULT_SETTINGS.privacy.logRetentionDays;
}

function addStringValue(target: Record<string, string>, raw: Record<string, unknown>, key: string): void {
  if (typeof raw[key] === "string") target[key] = raw[key];
}

function normalizeStringPresetMap(
  value: unknown,
  allowedKeys: string[],
): Record<string, Record<string, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const presets: Record<string, Record<string, string>> = {};
  for (const [presetKey, presetValue] of Object.entries(value)) {
    if (!presetValue || typeof presetValue !== "object" || Array.isArray(presetValue)) continue;
    const rawPreset = presetValue as Record<string, unknown>;
    const preset: Record<string, string> = {};
    for (const allowedKey of allowedKeys) {
      addStringValue(preset, rawPreset, allowedKey);
    }
    if (Object.keys(preset).length > 0) presets[presetKey] = preset;
  }
  return Object.keys(presets).length > 0 ? presets : undefined;
}

function normalizeProviderSettings(value: unknown): ProviderRuntimeSettings {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const settings: ProviderRuntimeSettings = {};
  if (typeof raw.bin === "string") settings.bin = raw.bin;
  if (typeof raw.apiKey === "string") settings.apiKey = raw.apiKey;
  if (typeof raw.apiKeyHelper === "string") settings.apiKeyHelper = raw.apiKeyHelper;
  if (typeof raw.permissionMode === "string") settings.permissionMode = raw.permissionMode;
  if (typeof raw.defaultModel === "string") settings.defaultModel = raw.defaultModel;
  const timeoutMs =
    typeof raw.timeoutMs === "number"
      ? raw.timeoutMs
      : typeof raw.timeoutMs === "string"
        ? Number(raw.timeoutMs)
        : NaN;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    settings.timeoutMs = Math.min(Math.floor(timeoutMs), MAX_PROVIDER_TIMEOUT_MS);
  }
  if (typeof raw.anthropicCompatEnabled === "boolean") {
    settings.anthropicCompatEnabled = raw.anthropicCompatEnabled;
  }
  if (typeof raw.anthropicBaseUrl === "string") settings.anthropicBaseUrl = raw.anthropicBaseUrl;
  if (typeof raw.anthropicAutoModel === "string") settings.anthropicAutoModel = raw.anthropicAutoModel;
  if (typeof raw.anthropicOpusModel === "string") settings.anthropicOpusModel = raw.anthropicOpusModel;
  if (typeof raw.anthropicSonnetModel === "string") settings.anthropicSonnetModel = raw.anthropicSonnetModel;
  if (typeof raw.anthropicHaikuModel === "string") settings.anthropicHaikuModel = raw.anthropicHaikuModel;
  if (typeof raw.claudeCodeSubagentModel === "string") {
    settings.claudeCodeSubagentModel = raw.claudeCodeSubagentModel;
  }
  const anthropicBaseUrlPresets = normalizeStringPresetMap(raw.anthropicBaseUrlPresets, [
    "apiKey",
    "anthropicBaseUrl",
    "anthropicAutoModel",
    "defaultModel",
    "anthropicOpusModel",
    "anthropicSonnetModel",
    "anthropicHaikuModel",
    "claudeCodeSubagentModel",
  ]);
  if (anthropicBaseUrlPresets) {
    settings.anthropicBaseUrlPresets = anthropicBaseUrlPresets;
  }
  if (typeof raw.codexCompatEnabled === "boolean") {
    settings.codexCompatEnabled = raw.codexCompatEnabled;
  }
  if (raw.codexUpstreamFormat === "responses" || raw.codexUpstreamFormat === "anthropic") {
    settings.codexUpstreamFormat = raw.codexUpstreamFormat;
  }
  if (typeof raw.codexAnthropicBaseUrl === "string") settings.codexAnthropicBaseUrl = raw.codexAnthropicBaseUrl;
  if (typeof raw.codexApiKey === "string") settings.codexApiKey = raw.codexApiKey;
  if (typeof raw.codexDefaultModel === "string") settings.codexDefaultModel = raw.codexDefaultModel;
  if (typeof raw.codexFastModel === "string") settings.codexFastModel = raw.codexFastModel;
  if (typeof raw.codexCodeModel === "string") settings.codexCodeModel = raw.codexCodeModel;
  const codexBaseUrlPresets = normalizeStringPresetMap(raw.codexBaseUrlPresets, [
    "codexAnthropicBaseUrl",
    "codexApiKey",
    "codexDefaultModel",
    "codexFastModel",
    "codexCodeModel",
  ]);
  if (codexBaseUrlPresets) {
    settings.codexBaseUrlPresets = codexBaseUrlPresets;
  }
  if (typeof raw.pathToClaudeCodeExecutable === "string") {
    settings.pathToClaudeCodeExecutable = raw.pathToClaudeCodeExecutable;
  }
  if (typeof raw.maxTurns === "number" && Number.isFinite(raw.maxTurns) && raw.maxTurns > 0) {
    settings.maxTurns = Math.floor(raw.maxTurns);
  }
  return settings;
}

function normalizeMcpServerSettings(id: string, value: unknown): McpServerSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const config = raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)
    ? { ...(raw.config as Record<string, unknown>) }
    : null;
  if (!config) return null;

  const now = new Date().toISOString();
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    config,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

function normalizeMcpSettings(value: unknown): AppSettings["mcp"] {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawServers = raw.servers && typeof raw.servers === "object" && !Array.isArray(raw.servers)
    ? raw.servers as Record<string, unknown>
    : {};
  const servers: Record<string, McpServerSettings> = {};
  for (const [id, server] of Object.entries(rawServers)) {
    const normalized = normalizeMcpServerSettings(id, server);
    if (normalized) servers[id] = normalized;
  }
  return { servers };
}

function mergeSettings(value: unknown): AppSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<AppSettings>;
  const general = (raw.general || {}) as Partial<AppSettings["general"]>;
  const workspace = (raw.workspace || {}) as Partial<AppSettings["workspace"]>;
  const permissions = (raw.permissions || {}) as Partial<AppSettings["permissions"]>;
  const privacy = (raw.privacy || {}) as Partial<AppSettings["privacy"]>;
  const providers = raw.providers && typeof raw.providers === "object" ? raw.providers : {};
  const mcp = normalizeMcpSettings(raw.mcp);
  const requestedWorkdir =
    typeof workspace.defaultWorkdir === "string" && workspace.defaultWorkdir.trim()
      ? path.resolve(workspace.defaultWorkdir.trim())
      : DEFAULT_SETTINGS.workspace.defaultWorkdir;

  return {
    general: {
      theme: isTheme(general.theme) ? general.theme : DEFAULT_SETTINGS.general.theme,
      language: isLanguage(general.language) ? general.language : DEFAULT_SETTINGS.general.language,
      fontSize: normalizeFontSize(general.fontSize),
      openAtLogin: typeof general.openAtLogin === "boolean" ? general.openAtLogin : DEFAULT_SETTINGS.general.openAtLogin,
      openWindowOnStart:
        typeof general.openWindowOnStart === "boolean"
          ? general.openWindowOnStart
          : DEFAULT_SETTINGS.general.openWindowOnStart,
      webPort:
        typeof general.webPort === "number" && Number.isFinite(general.webPort) && general.webPort > 0
          ? Math.floor(general.webPort)
          : DEFAULT_SETTINGS.general.webPort,
    },
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, config]) => [provider, normalizeProviderSettings(config)]),
    ),
    mcp,
    workspace: {
      defaultWorkdir: requestedWorkdir,
    },
    permissions: {
      requireDangerousConfirmation:
        typeof permissions.requireDangerousConfirmation === "boolean"
          ? permissions.requireDangerousConfirmation
          : DEFAULT_SETTINGS.permissions.requireDangerousConfirmation,
    },
    privacy: {
      logLevel: isLogLevel(privacy.logLevel) ? privacy.logLevel : DEFAULT_SETTINGS.privacy.logLevel,
      logIncludeContent:
        typeof privacy.logIncludeContent === "boolean"
          ? privacy.logIncludeContent
          : DEFAULT_SETTINGS.privacy.logIncludeContent,
      logIncludePrompt:
        typeof privacy.logIncludePrompt === "boolean"
          ? privacy.logIncludePrompt
          : DEFAULT_SETTINGS.privacy.logIncludePrompt,
      logRetentionDays: normalizeLogRetentionDays(privacy.logRetentionDays),
    },
  };
}

export function getDataDir(): string {
  return dataDir;
}

export function readAppSettings(): AppSettings {
  if (cachedSettings) {
    return cachedSettings;
  }

  ensureConfig();
  try {
    const rawText = readFileSync(CONFIG_PATH, "utf-8");
    const raw = JSON.parse(rawText);
    cachedSettings = mergeSettings(raw);
    ensureDesktopDefaultWorkdir(cachedSettings.workspace.defaultWorkdir);
    const normalizedText = JSON.stringify(cachedSettings, null, 2);
    if (rawText.trim() !== normalizedText) {
      writeFileSync(CONFIG_PATH, normalizedText, "utf-8");
    }
    return cachedSettings;
  } catch {
    cachedSettings = DEFAULT_SETTINGS;
    ensureDesktopDefaultWorkdir(cachedSettings.workspace.defaultWorkdir);
    writeFileSync(CONFIG_PATH, JSON.stringify(cachedSettings, null, 2), "utf-8");
    return cachedSettings;
  }
}

export function writeAppSettings(settings: AppSettings): AppSettings {
  const next = mergeSettings(settings);
  ensureConfig();
  ensureDesktopDefaultWorkdir(next.workspace.defaultWorkdir);
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  cachedSettings = next;
  return next;
}

export function updateAppSettings(partial: Partial<AppSettings>): AppSettings {
  const current = readAppSettings();
  return writeAppSettings(mergeSettings({
    ...current,
    ...partial,
    general: { ...current.general, ...(partial.general || {}) },
    providers: { ...current.providers, ...(partial.providers || {}) },
    mcp: { ...current.mcp, ...(partial.mcp || {}) },
    workspace: { ...current.workspace, ...(partial.workspace || {}) },
    permissions: { ...current.permissions, ...(partial.permissions || {}) },
    privacy: { ...current.privacy, ...(partial.privacy || {}) },
  }));
}

export function getProviderRuntimeSettings(providerType: string): ProviderRuntimeSettings {
  return readAppSettings().providers[providerType] || {};
}

/**
 * 取 Codex 上游协议格式，带迁移默认值：
 * 老配置（已存 codexAnthropicBaseUrl 但没有新字段）默认 anthropic，全新配置默认 responses。
 */
export function getCodexUpstreamFormat(settings: ProviderRuntimeSettings): CodexUpstreamFormat {
  if (settings.codexUpstreamFormat) return settings.codexUpstreamFormat;
  return settings.codexAnthropicBaseUrl?.trim() ? "anthropic" : "responses";
}

export function getConfiguredWebPort(): number {
  const raw = process.env.WEB_PORT;
  if (raw) {
    const port = Number.parseInt(raw, 10);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return readAppSettings().general.webPort;
}
