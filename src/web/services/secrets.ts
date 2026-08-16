import { readAppSettings, type AppSettings, type ProviderRuntimeSettings } from "../../app-settings.js";
import type { ChannelsConfig } from "../../channels/types.js";

/**
 * API 响应中的密钥字段一律替换为该掩码;写回时原样携带掩码表示"保持已存值不变"。
 */
export const SECRET_MASK = "__anybot_secret_unchanged__";

const PROVIDER_SECRET_FIELDS = ["apiKey", "codexApiKey"] as const;

const CHANNEL_SECRET_FIELDS: Record<string, readonly string[]> = {
  feishu: ["appSecret"],
  qqbot: ["appSecret"],
  dingtalk: ["appSecret"],
  telegram: ["token"],
  weixin: ["token"],
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: object): AnyRecord {
  return value as AnyRecord;
}

function maskRecord<T extends object>(record: T, fields: readonly string[]): T {
  const next: AnyRecord = { ...asRecord(record) };
  for (const field of fields) {
    const value = next[field];
    if (typeof value === "string" && value) next[field] = SECRET_MASK;
  }
  return next as T;
}

function restoreRecord(next: object, stored: object | null | undefined, fields: readonly string[]): void {
  const target = asRecord(next);
  const source = stored ? asRecord(stored) : undefined;
  for (const field of fields) {
    if (target[field] !== SECRET_MASK) continue;
    const value = source?.[field];
    if (typeof value === "string" && value) {
      target[field] = value;
    } else {
      delete target[field];
    }
  }
}

function maskPresetMap<T extends object>(
  presets: Record<string, T> | undefined,
  fields: readonly string[],
): Record<string, T> | undefined {
  if (!presets) return presets;
  return Object.fromEntries(
    Object.entries(presets).map(([key, preset]) => [key, maskRecord(preset, fields)]),
  );
}

function restorePresetMap<T extends object>(
  next: Record<string, T> | undefined,
  stored: Record<string, T> | undefined,
  fields: readonly string[],
): void {
  if (!next) return;
  for (const [key, preset] of Object.entries(next)) {
    if (preset && typeof preset === "object") {
      restoreRecord(preset, stored?.[key], fields);
    }
  }
}

function maskProviderSettings(settings: ProviderRuntimeSettings): ProviderRuntimeSettings {
  const next = maskRecord(settings, PROVIDER_SECRET_FIELDS) as ProviderRuntimeSettings;
  next.anthropicBaseUrlPresets = maskPresetMap(settings.anthropicBaseUrlPresets, ["apiKey"]);
  next.codexBaseUrlPresets = maskPresetMap(settings.codexBaseUrlPresets, ["codexApiKey"]);
  return next;
}

export function maskAppSettingsSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([type, cfg]) => [type, maskProviderSettings(cfg)]),
    ),
  };
}

/**
 * 把请求体里的掩码密钥还原为当前已存值,原地修改并返回 incoming。
 */
export function restoreAppSettingsSecrets<T extends { providers?: Record<string, ProviderRuntimeSettings> }>(
  incoming: T,
  current: AppSettings,
): T {
  if (!incoming.providers) return incoming;
  for (const [type, cfg] of Object.entries(incoming.providers)) {
    if (!cfg || typeof cfg !== "object") continue;
    const stored = current.providers[type];
    restoreRecord(cfg, stored, PROVIDER_SECRET_FIELDS);
    restorePresetMap(cfg.anthropicBaseUrlPresets, stored?.anthropicBaseUrlPresets, ["apiKey"]);
    restorePresetMap(cfg.codexBaseUrlPresets, stored?.codexBaseUrlPresets, ["codexApiKey"]);
  }
  return incoming;
}

export function maskChannelsConfig(config: ChannelsConfig): ChannelsConfig {
  const next: ChannelsConfig = { ...config };
  for (const [type, fields] of Object.entries(CHANNEL_SECRET_FIELDS)) {
    const cfg = config[type];
    if (cfg && typeof cfg === "object") {
      (next as AnyRecord)[type] = maskRecord(cfg as AnyRecord, fields);
    }
  }
  return next;
}

export function restoreChannelSecrets(
  channelType: string,
  partial: AnyRecord,
  current: AnyRecord | null,
): void {
  restoreRecord(partial, current ?? undefined, CHANNEL_SECRET_FIELDS[channelType] || []);
}

export function restoreChannelsConfigSecrets(incoming: ChannelsConfig, current: ChannelsConfig): ChannelsConfig {
  for (const type of Object.keys(CHANNEL_SECRET_FIELDS)) {
    const cfg = (incoming as AnyRecord)[type];
    if (cfg && typeof cfg === "object") {
      restoreChannelSecrets(type, cfg as AnyRecord, (current as AnyRecord)[type] as AnyRecord | null);
    }
  }
  return incoming;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * 前端"显示密钥"按钮按需取回明文:仅在用户显式点击时单字段返回。
 * presetKey 存在时只查对应 preset(与前端预设回填逻辑一致),否则取 provider 级字段。
 */
export function revealProviderSecret(providerType: string, field: string, presetKey?: string): string {
  if (field !== "apiKey" && field !== "codexApiKey") {
    throw new Error(`不支持读取的密钥字段: ${field}`);
  }
  const cfg = readAppSettings().providers[providerType];
  if (!cfg) return "";
  if (presetKey) {
    const preset = field === "apiKey"
      ? cfg.anthropicBaseUrlPresets?.[presetKey]
      : cfg.codexBaseUrlPresets?.[presetKey];
    const value = field === "apiKey"
      ? (preset as { apiKey?: string } | undefined)?.apiKey
      : (preset as { codexApiKey?: string } | undefined)?.codexApiKey;
    return typeof value === "string" ? value : "";
  }
  const value = field === "apiKey" ? cfg.apiKey : cfg.codexApiKey;
  return typeof value === "string" ? value : "";
}

/**
 * 前端只持有掩码时,按 Base URL 找回已保存的真实密钥(用于模型列表拉取等后端代发请求)。
 */
export function findStoredApiKeyForBaseUrl(baseUrl: string): string {
  const target = normalizeBaseUrl(baseUrl);
  if (!target) return "";
  for (const cfg of Object.values(readAppSettings().providers)) {
    if (cfg.apiKey && cfg.anthropicBaseUrl && normalizeBaseUrl(cfg.anthropicBaseUrl) === target) {
      return cfg.apiKey;
    }
    if (cfg.codexApiKey && cfg.codexAnthropicBaseUrl && normalizeBaseUrl(cfg.codexAnthropicBaseUrl) === target) {
      return cfg.codexApiKey;
    }
    for (const preset of Object.values(cfg.anthropicBaseUrlPresets || {})) {
      if (preset.apiKey && preset.anthropicBaseUrl && normalizeBaseUrl(preset.anthropicBaseUrl) === target) {
        return preset.apiKey;
      }
    }
    for (const preset of Object.values(cfg.codexBaseUrlPresets || {})) {
      if (preset.codexApiKey && preset.codexAnthropicBaseUrl && normalizeBaseUrl(preset.codexAnthropicBaseUrl) === target) {
        return preset.codexApiKey;
      }
    }
  }
  return "";
}
