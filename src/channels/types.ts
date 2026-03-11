export interface ChannelConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  [key: string]: unknown;
}

export interface FeishuChannelConfig extends ChannelConfig {
  groupChatMode: "mention" | "all";
  botOpenId: string;
  ackReaction: string;
}

export interface QQBotChannelConfig extends ChannelConfig {
  // qqbot 只需要基础的 enabled, appId, appSecret，已继承自 ChannelConfig
  [key: string]: unknown;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  token: string;
  [key: string]: unknown;
}

export interface ChannelsConfig {
  [channelType: string]: ChannelConfig | TelegramChannelConfig | undefined;
  feishu?: FeishuChannelConfig;
  qqbot?: QQBotChannelConfig;
  telegram?: TelegramChannelConfig;
}

export interface ChannelCallbacks {
  generateReply: (
    chatId: string,
    userText: string,
    imagePaths?: string[],
    source?: string,
  ) => Promise<string>;
  resetSession: (chatId: string, source?: string) => void;
}

export interface IChannel {
  readonly type: string;
  start(callbacks: ChannelCallbacks): Promise<void>;
  stop(): Promise<void>;
}
