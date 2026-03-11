import type { IChannel, ChannelCallbacks } from "./types.js";
import { readChannelsConfig } from "./config.js";
import { FeishuChannel } from "./feishu.js";
import { QQBotChannel } from "./qqbot.js";
import { TelegramChannel } from "./telegram.js";
import { logger } from "../logger.js";

type ChannelFactory = () => IChannel;

const channelFactories: Record<string, ChannelFactory> = {
  feishu: () => new FeishuChannel(),
  qqbot: () => new QQBotChannel(),
  telegram: () => new TelegramChannel(),
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
        await channel.start(callbacks);
        this.runningChannels.set(type, channel);
        started.push(channel);
        logger.info("channel.started", { type });
      } catch (error) {
        logger.error("channel.start_failed", { type, error });
      }
    }

    return started;
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
      await channel.start(this.callbacks);
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

export { readChannelsConfig, readChannelConfig, updateChannelConfig } from "./config.js";
export type { IChannel, ChannelCallbacks, ChannelsConfig, ChannelConfig, FeishuChannelConfig, TelegramChannelConfig } from "./types.js";
