import { Router } from "express";
import type { Request, Response } from "express";
import { getRegisteredChannelTypes, readChannelsConfig } from "../../channels/index.js";
import { logger } from "../../logger.js";
import { getRegisteredProviderTypes } from "../../providers/index.js";
import * as db from "../db.js";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  listAutomationRuns,
  updateAutomation,
  type AutomationInput,
} from "../services/automations.js";

const LOCAL_CHANNEL_TYPE = "local";

function validateAutomationInput(input: AutomationInput): string | null {
  if (!input.name || typeof input.name !== "string" || !input.name.trim()) return "缺少任务名称";
  if (!input.prompt || typeof input.prompt !== "string" || !input.prompt.trim()) return "缺少执行内容";
  if (!input.provider || typeof input.provider !== "string") return "缺少提供商";
  if (!getRegisteredProviderTypes().includes(input.provider)) return `不支持的提供商: ${input.provider}`;
  if (!input.channelType || typeof input.channelType !== "string") return "缺少交付方式";
  if (input.channelType !== LOCAL_CHANNEL_TYPE && !getRegisteredChannelTypes().includes(input.channelType)) {
    return `不支持的交付方式: ${input.channelType}`;
  }
  if (input.channelType !== LOCAL_CHANNEL_TYPE && input.enabled !== false) {
    const channelsConfig = readChannelsConfig();
    if (!channelsConfig[input.channelType]?.enabled) return "交付方式未开启";
  }
  if (input.projectId && !db.getProject(input.projectId)) return "项目不存在";
  return null;
}

export function createAutomationsRouter(): Router {
  const router = Router();

  router.get("/automations", (_req: Request, res: Response) => {
    try {
      res.json({ automations: listAutomations() });
    } catch (error) {
      res.status(500).json({ error: "读取自动化配置失败" });
    }
  });

  router.get("/automations/:id/runs", (req: Request, res: Response) => {
    try {
      const automation = getAutomation(req.params.id as string);
      if (!automation) {
        res.status(404).json({ error: "自动化不存在" });
        return;
      }
      res.json({ runs: listAutomationRuns(automation.id) });
    } catch (error) {
      res.status(500).json({ error: "读取自动化运行记录失败" });
    }
  });

  router.post("/automations", (req: Request, res: Response) => {
    const input = req.body as AutomationInput;
    const validationError = validateAutomationInput(input);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    try {
      const automation = createAutomation(input);
      logger.info("automation.created", { id: automation.id });
      res.json({ automation });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "创建自动化失败";
      res.status(400).json({ error: msg });
    }
  });

  router.put("/automations/:id", (req: Request, res: Response) => {
    const input = req.body as AutomationInput;
    const validationError = validateAutomationInput(input);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    try {
      const automation = updateAutomation(req.params.id as string, input);
      if (!automation) {
        res.status(404).json({ error: "自动化不存在" });
        return;
      }
      logger.info("automation.updated", { id: automation.id });
      res.json({ automation });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新自动化失败";
      res.status(400).json({ error: msg });
    }
  });

  router.delete("/automations/:id", (req: Request, res: Response) => {
    try {
      if (!deleteAutomation(req.params.id as string)) {
        res.status(404).json({ error: "自动化不存在" });
        return;
      }
      logger.info("automation.deleted", { id: req.params.id });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "删除自动化失败" });
    }
  });

  return router;
}
