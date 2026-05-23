import { Router } from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import { getDataDir, readAppSettings, writeAppSettings, type AppSettings } from "../../app-settings.js";
import {
  readChannelsConfig,
  writeChannelsConfig,
} from "../../channels/index.js";
import { logger, getLogDir } from "../../logger.js";
import { applyProxy, isProxyFeatureEnabled } from "../../proxy.js";
import { readSandboxConfig, setDefaultSandbox } from "../../sandbox-config.js";
import { openDirectory } from "../../utils/open-directory.js";
import * as db from "../db.js";
import { emitHistoryCleared } from "../events.js";
import { readModelConfig, writeModelConfig } from "../model-config.js";
import { readProxyConfig, writeProxyConfig, type ProxyConfig } from "../proxy-config.js";
import { getUploadDir } from "../services/files.js";

export function createDataRouter(): Router {
  const router = Router();

  router.post("/logs/open", (_req: Request, res: Response) => {
    try {
      fs.mkdirSync(getLogDir(), { recursive: true });
      openDirectory(getLogDir());
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开日志目录失败" });
    }
  });

  router.delete("/logs", (_req: Request, res: Response) => {
    try {
      fs.rmSync(getLogDir(), { recursive: true, force: true });
      fs.mkdirSync(getLogDir(), { recursive: true });
      logger.info("logs.cleared");
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "清空日志失败" });
    }
  });

  router.post("/data/open", (_req: Request, res: Response) => {
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      openDirectory(getDataDir());
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开数据目录失败" });
    }
  });

  router.delete("/data/uploads", (_req: Request, res: Response) => {
    try {
      fs.rmSync(getUploadDir(), { recursive: true, force: true });
      fs.mkdirSync(getUploadDir(), { recursive: true });
      logger.info("uploads.cleared");
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "清理上传文件失败" });
    }
  });

  router.delete("/data/history", (_req: Request, res: Response) => {
    try {
      db.deleteAllSessions();
      emitHistoryCleared();
      logger.info("history.cleared");
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "清空历史失败" });
    }
  });

  router.get("/data/export", (_req: Request, res: Response) => {
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        appSettings: readAppSettings(),
        modelConfig: readModelConfig(),
        sandboxConfig: readSandboxConfig(),
        proxyConfig: readProxyConfig(),
        channelsConfig: readChannelsConfig(),
      };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="anybot-config-${Date.now()}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      res.status(500).json({ error: "导出配置失败" });
    }
  });

  router.put("/data/import", (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        appSettings?: AppSettings;
        modelConfig?: ReturnType<typeof readModelConfig>;
        sandboxConfig?: ReturnType<typeof readSandboxConfig>;
        proxyConfig?: ProxyConfig;
        channelsConfig?: ReturnType<typeof readChannelsConfig>;
      };
      if (payload.appSettings) writeAppSettings(payload.appSettings);
      if (payload.modelConfig) writeModelConfig(payload.modelConfig);
      if (payload.sandboxConfig?.defaultSandbox) setDefaultSandbox(payload.sandboxConfig.defaultSandbox);
      if (payload.proxyConfig) {
        if (isProxyFeatureEnabled()) {
          writeProxyConfig(payload.proxyConfig);
          applyProxy(payload.proxyConfig);
        } else {
          applyProxy();
        }
      }
      if (payload.channelsConfig) writeChannelsConfig(payload.channelsConfig);
      logger.info("data.imported");
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "导入配置失败" });
    }
  });

  return router;
}
