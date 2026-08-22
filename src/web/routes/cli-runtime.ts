import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../../logger.js";
import { readAppSettings } from "../../app-settings.js";
import {
  ensureCliRuntime,
  getCliRuntimeStatus,
  listCliRuntimeStatus,
  type CliRuntimeEvent,
} from "../../cli-runtime/installer.js";
import type { CliRuntimeProvider } from "../../cli-runtime/manifest.js";

/** 归一化 provider 参数，仅支持两个内置 CLI 组件 */
function parseProvider(value: unknown): CliRuntimeProvider | null {
  const normalized = value === "claude-agent" ? "claude-code" : value;
  return normalized === "codex" || normalized === "claude-code" ? normalized : null;
}

function writeDownloadEvent(res: Response, event: CliRuntimeEvent): void {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

export function createCliRuntimeRouter(): Router {
  const router = Router();

  // 全部内置 CLI 组件的安装状态（前端初始化用）
  router.get("/cli-runtime/status", (req: Request, res: Response) => {
    res.json({ runtimes: listCliRuntimeStatus() });
  });

  // 单个组件状态
  router.get("/cli-runtime/status/:provider", (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    if (!provider) {
      res.status(400).json({ error: "不支持的组件" });
      return;
    }
    res.json(getCliRuntimeStatus(provider));
  });

  // 触发下载：NDJSON 流式回报进度；并发请求订阅同一次安装
  router.post("/cli-runtime/download", async (req: Request, res: Response) => {
    const provider = parseProvider(req.body?.provider);
    if (!provider) {
      res.status(400).json({ error: "不支持的组件" });
      return;
    }

    const source = readAppSettings().cliRuntime.downloadSource;

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      await ensureCliRuntime(provider, source, (event) => writeDownloadEvent(res, event));
      logger.info("cli_runtime.installed", { provider });
    } catch (error) {
      // 错误事件已由 ensureCliRuntime 广播给所有订阅者，这里只记录日志
      const message = error instanceof Error ? error.message : "下载失败";
      logger.warn("cli_runtime.install_failed", { provider, error: message });
    } finally {
      res.end();
    }
  });

  return router;
}
