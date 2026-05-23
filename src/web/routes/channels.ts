import { Router } from "express";
import type { Request, Response } from "express";
import {
  channelManager,
  getRegisteredChannelTypes,
  readChannelsConfig,
  updateChannelConfig,
} from "../../channels/index.js";
import { getWeixinLoginStatus } from "../../channels/weixin.js";
import { logger } from "../../logger.js";

export function createChannelsRouter(): Router {
  const router = Router();

  router.get("/channels", (_req: Request, res: Response) => {
    try {
      const config = readChannelsConfig();
      const registered = getRegisteredChannelTypes();
      res.json({ registered, config });
    } catch (error) {
      res.status(500).json({ error: "读取频道配置失败" });
    }
  });

  router.put("/channels/:type", (req: Request, res: Response) => {
    const channelType = req.params.type as string;
    const registered = getRegisteredChannelTypes();
    if (!registered.includes(channelType)) {
      res.status(400).json({ error: `不支持的频道类型: ${channelType}` });
      return;
    }
    try {
      const config = updateChannelConfig(channelType, req.body);
      logger.info("channel.config.updated", { channelType });
      res.json(config);

      channelManager.restartChannel(channelType).catch((error) => {
        logger.error("channel.restart_after_save_failed", { channelType, error });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新频道配置失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/channels/weixin/login-status", (_req: Request, res: Response) => {
    res.json(getWeixinLoginStatus());
  });

  return router;
}
