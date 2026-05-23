import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../../logger.js";
import { deleteSkill, listSkillMentions, listSkills, openSkillsFolder, toggleSkill } from "../skills.js";
import { listWebSlashItems } from "../slash-items.js";

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

  return router;
}
