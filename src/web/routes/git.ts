import { Router } from "express";
import type { Request, Response } from "express";
import { checkoutGitBranch, getGitBranchInfo, resolveGitWorkdir } from "../services/git.js";

function readStringQuery(value: Request["query"][string]): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

export function createGitRouter(): Router {
  const router = Router();

  router.get("/git/branches", async (req: Request, res: Response) => {
    try {
      const workdir = resolveGitWorkdir({
        sessionId: readStringQuery(req.query.sessionId) || undefined,
        projectId: readStringQuery(req.query.projectId) || undefined,
      });
      res.json(await getGitBranchInfo(workdir));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || "获取分支失败" });
    }
  });

  router.post("/git/checkout", async (req: Request, res: Response) => {
    const body = (req.body || {}) as { sessionId?: unknown; projectId?: unknown; branch?: unknown };
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    if (!branch) {
      res.status(400).json({ error: "缺少分支名" });
      return;
    }
    try {
      const workdir = resolveGitWorkdir({
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      });
      const current = await checkoutGitBranch(workdir, branch);
      res.json({ ok: true, current });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || "切换分支失败" });
    }
  });

  return router;
}
