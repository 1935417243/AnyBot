import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ChannelsConfig, FeishuChannelConfig, QQBotChannelConfig, TelegramChannelConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../.data/channels.json");

const DEFAULT_CONFIG: ChannelsConfig = {
  feishu: {
    enabled: false,
    appId: "",
    appSecret: "",
    groupChatMode: "mention",
    botOpenId: "",
    ackReaction: "OK",
  } satisfies FeishuChannelConfig,
  qqbot: {
    enabled: false,
    appId: "",
    appSecret: "",
  } satisfies QQBotChannelConfig,
  telegram: {
    enabled: false,
    token: "",
  } satisfies TelegramChannelConfig,
};

function ensureConfig(): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  }
}

export function readChannelsConfig(): ChannelsConfig {
  ensureConfig();
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as ChannelsConfig;
}

export function readChannelConfig<T extends ChannelsConfig[string]>(
  channelType: string,
): T | null {
  const config = readChannelsConfig();
  return (config[channelType] as T) ?? null;
}

export function writeChannelsConfig(config: ChannelsConfig): void {
  ensureConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function updateChannelConfig(
  channelType: string,
  partial: Partial<ChannelsConfig[string]>,
): ChannelsConfig {
  const config = readChannelsConfig();
  config[channelType] = { ...config[channelType], ...partial } as ChannelsConfig[string];
  writeChannelsConfig(config);
  return config;
}
