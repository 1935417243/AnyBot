import { Router } from "express";
import type { Request, Response } from "express";
import { channelManager, getRegisteredChannelTypes } from "../../channels/index.js";
import { logger } from "../../logger.js";

export function createSendRouter(): Router {
  const router = Router();

  router.post("/send", async (req: Request, res: Response) => {
    const { channel, message } = req.body as {
      channel?: string;
      message?: string;
    };

    if (!channel) {
      res.status(400).json({ error: `缺少 channel 参数（${getRegisteredChannelTypes().join(" / ")}）` });
      return;
    }
    if (!message?.trim()) {
      res.status(400).json({ error: "缺少 message 参数" });
      return;
    }

    const registered = getRegisteredChannelTypes();
    if (!registered.includes(channel)) {
      res.status(400).json({ error: `不支持的频道类型: ${channel}，可选: ${registered.join(", ")}` });
      return;
    }

    const ch = channelManager.getChannel(channel);
    if (!ch) {
      const running = channelManager.getRunningChannelTypes();
      res.status(400).json({
        error: `频道 ${channel} 未启动，当前运行中: ${running.length ? running.join(", ") : "无"}`,
      });
      return;
    }

    try {
      await ch.sendToOwner(message.trim());
      logger.info("api.send.success", { channel, messageChars: message.trim().length });
      res.json({ ok: true });
    } catch (error) {
      logger.error("api.send.failed", { channel, error });
      const msg = error instanceof Error ? error.message : "发送消息失败";
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
