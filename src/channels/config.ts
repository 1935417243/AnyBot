import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ChannelsConfig,
  DingtalkChannelConfig,
  FeishuChannelConfig,
  QQBotChannelConfig,
  TelegramChannelConfig,
  WeixinChannelConfig,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.resolve(__dirname, "../../.data");
const CONFIG_PATH = path.join(dataDir, "channels.json");

const DEFAULT_CONFIG: ChannelsConfig = {
  feishu: {
    enabled: false,
    appId: "",
    appSecret: "",
    groupChatMode: "mention",
    botOpenId: "",
    ackReaction: "OK",
    ownerChatId: "",
  } satisfies FeishuChannelConfig,
  qqbot: {
    enabled: false,
    appId: "",
    appSecret: "",
    ownerChatId: "",
  } satisfies QQBotChannelConfig,
  dingtalk: {
    enabled: false,
    appId: "",
    appSecret: "",
    ownerChatId: "",
  } satisfies DingtalkChannelConfig,
  telegram: {
    enabled: false,
    token: "",
    ownerChatId: "",
  } satisfies TelegramChannelConfig,
  weixin: {
    enabled: false,
    accountId: "",
    token: "",
    baseUrl: "https://ilinkai.weixin.qq.com",
    botType: "3",
    botAgent: "AnyBot/0.1.0",
    ownerChatId: "",
  } satisfies WeixinChannelConfig,
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
