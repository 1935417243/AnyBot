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

export interface ChannelsConfig {
  [channelType: string]: ChannelConfig;
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
