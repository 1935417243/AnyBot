export interface ChannelConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  ownerChatId?: string;
  [key: string]: unknown;
}

export interface FeishuChannelConfig extends ChannelConfig {
  groupChatMode: "mention" | "all";
  botOpenId: string;
  ackReaction: string;
}

export interface QQBotChannelConfig extends ChannelConfig {
  [key: string]: unknown;
}

export interface DingtalkChannelConfig extends ChannelConfig {}

export interface TelegramChannelConfig {
  enabled: boolean;
  token: string;
  ownerChatId?: string;
  [key: string]: unknown;
}

export interface WeixinChannelConfig {
  enabled: boolean;
  accountId: string;
  token: string;
  baseUrl: string;
  botType: string;
  botAgent: string;
  ownerChatId?: string;
  [key: string]: unknown;
}

export interface ChannelsConfig {
  [channelType: string]: ChannelConfig | TelegramChannelConfig | WeixinChannelConfig | undefined;
  feishu?: FeishuChannelConfig;
  qqbot?: QQBotChannelConfig;
  dingtalk?: DingtalkChannelConfig;
  telegram?: TelegramChannelConfig;
  weixin?: WeixinChannelConfig;
}

export interface ProviderInfo {
  type: string;
  displayName: string;
  isCurrent: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  isCurrent: boolean;
}

export interface WorkspaceInfo {
  id: string | null;
  name: string;
  path: string;
  isCurrent: boolean;
}

export interface ChannelCallbacks {
  generateReply: (
    chatId: string,
    userText: string,
    imagePaths?: string[],
    source?: string,
  ) => Promise<string>;
  resetSession: (chatId: string, source?: string) => void;
  listProviders: () => ProviderInfo[];
  switchProvider: (providerType: string) => { success: boolean; message: string };
  listModels: () => ModelInfo[];
  switchModel: (modelId: string) => { success: boolean; message: string };
  listWorkspaces: (chatId: string, source: string) => WorkspaceInfo[];
  switchWorkspace: (
    chatId: string,
    source: string,
    workspaceId: string | null,
  ) => { success: boolean; message: string };
}

export interface IChannel {
  readonly type: string;
  start(callbacks: ChannelCallbacks): Promise<boolean>;
  stop(): Promise<void>;
  sendToOwner(text: string): Promise<void>;
}
