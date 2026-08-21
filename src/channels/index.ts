import type { IChannel, ChannelCallbacks } from "./types.js";
import { readChannelsConfig } from "./config.js";
import { DingtalkChannel } from "./dingtalk.js";
import { FeishuChannel } from "./feishu.js";
import { QQBotChannel } from "./qqbot.js";
import { TelegramChannel } from "./telegram.js";
import { WeixinChannel } from "./weixin.js";
import { logger } from "../logger.js";

type ChannelFactory = () => IChannel;

const channelFactories: Record<string, ChannelFactory> = {
  feishu: () => new FeishuChannel(),
  qqbot: () => new QQBotChannel(),
  dingtalk: () => new DingtalkChannel(),
  telegram: () => new TelegramChannel(),
  weixin: () => new WeixinChannel(),
};

export function getRegisteredChannelTypes(): string[] {
  return Object.keys(channelFactories);
}

class ChannelManager {
  private runningChannels = new Map<string, IChannel>();
  private callbacks: ChannelCallbacks | null = null;

  async startAll(callbacks: ChannelCallbacks): Promise<IChannel[]> {
    this.callbacks = callbacks;
    const config = readChannelsConfig();
    const started: IChannel[] = [];

    for (const [type, factory] of Object.entries(channelFactories)) {
      const channelConfig = config[type];
      if (!channelConfig?.enabled) {
        logger.info("channel.skipped", { type, reason: "disabled" });
        continue;
      }

      try {
        const channel = factory();
        const didStart = await channel.start(callbacks);
        if (!didStart) {
          logger.info("channel.not_started", { type });
          continue;
        }
        this.runningChannels.set(type, channel);
        started.push(channel);
        logger.info("channel.started", { type });
      } catch (error) {
        logger.error("channel.start_failed", { type, error });
      }
    }

    return started;
  }

  getChannel(type: string): IChannel | undefined {
    return this.runningChannels.get(type);
  }

  getRunningChannelTypes(): string[] {
    return Array.from(this.runningChannels.keys());
  }

  async stopAll(): Promise<void> {
    const entries = Array.from(this.runningChannels.entries());
    this.runningChannels.clear();
    await Promise.all(
      entries.map(async ([type, channel]) => {
        try {
          await channel.stop();
          logger.info("channel.stopped", { type });
        } catch (error) {
          logger.error("channel.stop_failed", { type, error });
        }
      }),
    );
  }

  async startChannelLogin(type: string): Promise<boolean> {
    if (!this.callbacks) {
      logger.warn("channel.login_skipped", { type, reason: "no callbacks registered" });
      return false;
    }

    const existing = this.runningChannels.get(type);
    if (existing) {
      try {
        await existing.stop();
        logger.info("channel.stopped", { type });
      } catch (error) {
        logger.error("channel.stop_failed", { type, error });
      }
      this.runningChannels.delete(type);
    }

    const factory = channelFactories[type];
    if (!factory) {
      logger.warn("channel.login.unknown_type", { type });
      return false;
    }

    const channel = factory();
    if (typeof channel.startLogin !== "function") {
      logger.warn("channel.login.unsupported", { type });
      return false;
    }

    try {
      const started = await channel.startLogin(this.callbacks);
      if (started) {
        this.runningChannels.set(type, channel);
        logger.info("channel.login_started", { type });
      }
      return started;
    } catch (error) {
      logger.error("channel.login_failed", { type, error });
      return false;
    }
  }

  async restartChannel(type: string): Promise<void> {
    if (!this.callbacks) {
      logger.warn("channel.restart_skipped", { type, reason: "no callbacks registered" });
      return;
    }

    const existing = this.runningChannels.get(type);
    if (existing) {
      try {
        await existing.stop();
        logger.info("channel.stopped", { type });
      } catch (error) {
        logger.error("channel.stop_failed", { type, error });
      }
      this.runningChannels.delete(type);
    }

    const config = readChannelsConfig();
    const channelConfig = config[type];
    if (!channelConfig?.enabled) {
      logger.info("channel.restart.disabled", { type });
      return;
    }

    const factory = channelFactories[type];
    if (!factory) {
      logger.warn("channel.restart.unknown_type", { type });
      return;
    }

    try {
      const channel = factory();
      const didStart = await channel.start(this.callbacks);
      if (!didStart) {
        logger.info("channel.restart.not_started", { type });
        return;
      }
      this.runningChannels.set(type, channel);
      logger.info("channel.restarted", { type });
    } catch (error) {
      logger.error("channel.restart_failed", { type, error });
    }
  }
}

export const channelManager = new ChannelManager();

export async function startAllChannels(
  callbacks: ChannelCallbacks,
): Promise<IChannel[]> {
  return channelManager.startAll(callbacks);
}

export async function stopAllChannels(): Promise<void> {
  return channelManager.stopAll();
}

export { readChannelsConfig, readChannelConfig, writeChannelsConfig, updateChannelConfig } from "./config.js";
export type {
  IChannel,
  ChannelCallbacks,
  ChannelsConfig,
  ChannelConfig,
  DingtalkChannelConfig,
  FeishuChannelConfig,
  TelegramChannelConfig,
  WeixinChannelConfig,
} from "./types.js";
