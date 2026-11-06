import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../../logger.js";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  hasRunningAutomationRun,
  listAutomations,
  listAutomationRuns,
  updateAutomation,
  validateAutomationInput as validateAutomationBaseInput,
  validateAutomationSchedule,
  type AutomationInput,
} from "../services/automations.js";
import { triggerAutomationRun } from "../services/automation-runner.js";

const RUN_PAGE_SIZE = 10;

function readPageParam(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function validateAutomationInput(input: AutomationInput): string | null {
  const baseError = validateAutomationBaseInput(input);
  if (baseError) return baseError;
  // 其它触发类型沿用 normalizeSchedule 的兜底；一次性任务时间和 cron 表达式无法兜底（非法值会导致永不执行），必须严格校验
  if (input.schedule?.type === "once" || input.schedule?.type === "cron") {
    return validateAutomationSchedule(input.schedule, { enabled: input.enabled !== false });
  }
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
      const page = listAutomationRuns(automation.id, readPageParam(req.query.page), RUN_PAGE_SIZE);
      res.json(page);
    } catch (error) {
      res.status(500).json({ error: "读取自动化运行记录失败" });
    }
  });

  router.get("/automations/:id/run-status", (req: Request, res: Response) => {
    try {
      const automation = getAutomation(req.params.id as string);
      if (!automation) {
        res.status(404).json({ error: "自动化不存在" });
        return;
      }
      res.json({ running: hasRunningAutomationRun(automation.id) });
    } catch (error) {
      res.status(500).json({ error: "读取自动化执行状态失败" });
    }
  });

  router.post("/automations/:id/run", (req: Request, res: Response) => {
    try {
      const automation = getAutomation(req.params.id as string);
      if (!automation) {
        res.status(404).json({ error: "自动化不存在" });
        return;
      }
      if (hasRunningAutomationRun(automation.id)) {
        res.status(409).json({ error: "当前自动化已有任务执行中" });
        return;
      }
      const run = triggerAutomationRun(automation);
      logger.info("automation.run_once.started", { id: automation.id, runId: run.id });
      res.status(202).json({ run });
    } catch (error) {
      res.status(500).json({ error: "执行自动化失败" });
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
