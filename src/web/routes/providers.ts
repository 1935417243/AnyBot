import { Router } from "express";
import type { Request, Response } from "express";
import { getProvider } from "../../providers/index.js";
import { logger } from "../../logger.js";
import { readSandboxConfig, sandboxModeOptions, setDefaultSandbox } from "../../sandbox-config.js";
import {
  getProviderTypes,
  readModelConfig,
  readModelConfigForProvider,
  setCurrentEffort,
  setCurrentModel,
  setCurrentProvider,
  setEffortForProvider,
  setModelForProvider,
} from "../model-config.js";
import type { EffortLevel } from "../../providers/types.js";
import { fetchProviderModels, ProviderModelFetchError } from "../services/provider-models.js";

export function createProvidersRouter(): Router {
  const router = Router();

  router.post("/provider-models", async (req: Request, res: Response) => {
    const body = req.body as { baseUrl?: unknown; apiKey?: unknown } | undefined;
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

    try {
      res.json(await fetchProviderModels(baseUrl, apiKey));
    } catch (error) {
      if (error instanceof ProviderModelFetchError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(502).json({ error: error instanceof Error ? error.message : "获取模型列表失败" });
    }
  });

  router.get("/model-config", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : "";
      res.json(provider ? readModelConfigForProvider(provider) : readModelConfig());
    } catch (error) {
      res.status(500).json({ error: "读取模型配置失败" });
    }
  });

  router.put("/model-config", (req: Request, res: Response) => {
    const { modelId, provider, effort } = req.body as {
      modelId?: string;
      provider?: string;
      effort?: string;
    };
    if (!modelId && !effort) {
      res.status(400).json({ error: "缺少 modelId 或 effort" });
      return;
    }
    try {
      // 强度档位与模型互不依赖，允许同请求一起更新，后者覆盖返回体；
      // 带 provider 时按该 provider 校验并持久化档位（claude-code 与 codex 档位集合不同）
      let config = effort
        ? provider
          ? setEffortForProvider(provider, effort as EffortLevel)
          : setCurrentEffort(effort as EffortLevel)
        : undefined;
      if (modelId) {
        config = provider ? setModelForProvider(provider, modelId) : setCurrentModel(modelId);
        logger.info("model.switched", { modelId, provider: provider || config.provider });
      }
      if (effort) {
        logger.info("model.effort_switched", { effort, provider: config?.provider });
      }
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换模型失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/providers", (_req: Request, res: Response) => {
    try {
      const providers = getProviderTypes();
      const current = getProvider().type;
      res.json({ current, providers });
    } catch (error) {
      res.status(500).json({ error: "读取 Provider 列表失败" });
    }
  });

  router.put("/providers/current", (req: Request, res: Response) => {
    const { provider } = req.body as { provider?: string };
    if (!provider) {
      res.status(400).json({ error: "缺少 provider" });
      return;
    }
    try {
      const config = setCurrentProvider(provider);
      logger.info("provider.switched", { provider });
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换 Provider 失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/sandbox-config", (_req: Request, res: Response) => {
    try {
      res.json({
        ...readSandboxConfig(),
        modes: sandboxModeOptions,
      });
    } catch (error) {
      res.status(500).json({ error: "读取权限配置失败" });
    }
  });

  router.put("/sandbox-config", (req: Request, res: Response) => {
    const { defaultSandbox } = req.body as { defaultSandbox?: string };
    if (!defaultSandbox) {
      res.status(400).json({ error: "缺少 defaultSandbox" });
      return;
    }
    try {
      const config = setDefaultSandbox(defaultSandbox);
      logger.info("sandbox.switched", { sandbox: config.defaultSandbox });
      res.json({
        ...config,
        modes: sandboxModeOptions,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "保存权限配置失败";
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
