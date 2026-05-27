import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../../logger.js";
import { normalizeProviderType } from "../../providers/index.js";
import { deleteSkill, listSkillMentions, listSkills, openSkillsFolder, toggleSkill } from "../skills.js";
import { listWebSlashItems } from "../slash-items.js";
import {
  downloadOfficialClaudeSkills,
  type OfficialSkillDownloadEvent,
} from "../services/official-skills.js";

function writeDownloadProgress(res: Response, event: OfficialSkillDownloadEvent): void {
  res.write(`${JSON.stringify(event)}\n`);
}

export function createSkillsRouter(): Router {
  const router = Router();

  router.get("/slash/items", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      res.json(listWebSlashItems(provider));
    } catch (error) {
      res.status(500).json({ error: "读取快捷项失败" });
    }
  });

  router.get("/skills", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      res.json(listSkills(provider));
    } catch (error) {
      res.status(500).json({ error: "读取技能列表失败" });
    }
  });

  router.get("/skills/mentions", (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      res.json({ skills: listSkillMentions(provider) });
    } catch (error) {
      res.status(500).json({ error: "读取技能列表失败" });
    }
  });

  router.put("/skills/:id/toggle", (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id as string);
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "缺少 enabled 参数" });
      return;
    }
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      const result = toggleSkill(id, enabled, provider);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      logger.info("skill.toggled", { id, enabled });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "切换技能状态失败" });
    }
  });

  router.delete("/skills/:id", (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id as string);
    const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    const result = deleteSkill(id, provider);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    logger.info("skill.deleted", { id });
    res.json({ ok: true });
  });

  router.post("/skills/open-folder", (req: Request, res: Response) => {
    try {
      const skillPath = req.body?.path as string | undefined;
      const provider = typeof req.body?.provider === "string" ? req.body.provider : undefined;
      openSkillsFolder(skillPath, provider);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开文件夹失败" });
    }
  });

  router.post("/skills/download-official", async (req: Request, res: Response) => {
    const provider = typeof req.body?.provider === "string" ? normalizeProviderType(req.body.provider) : "";
    if (provider !== "claude-code") {
      res.status(400).json({ error: "官方技能包仅支持 Claude Code 技能目录" });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      const result = await downloadOfficialClaudeSkills((event) => writeDownloadProgress(res, event));
      logger.info("official_skills.downloaded", {
        installed: result.installed.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载官方技能失败";
      logger.warn("official_skills.download_failed", { error: message });
      writeDownloadProgress(res, {
        phase: "failed",
        message,
        percent: 100,
        completed: 0,
        total: 0,
        targetDir: "",
        installed: [],
        skipped: [],
        failed: [{ name: "official-skills", error: message }],
      });
    } finally {
      res.end();
    }
  });

  return router;
}
