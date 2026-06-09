import { Router } from "express";
import type { Request, Response } from "express";
import { getWorkdir } from "../../shared.js";
import * as db from "../db.js";
import {
  cloneProjectFromGit,
  createOrTouchProject,
  deleteProject,
  getDefaultGitSaveDirectory,
  getSavedGitCredentialSummary,
  pickProjectFolder,
  readProjectTree,
  setDefaultGitSaveDirectory,
} from "../services/projects.js";

export function createProjectsRouter(): Router {
  const router = Router();

  router.get("/projects", (_req: Request, res: Response) => {
    res.json(db.listProjects());
  });

  router.post("/projects", (req: Request, res: Response) => {
    const { path: projectPath } = req.body as { path?: string };
    try {
      const project = createOrTouchProject(projectPath || "");
      res.json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "添加项目失败" });
    }
  });

  router.post("/projects/pick", async (_req: Request, res: Response) => {
    try {
      const projectPath = await pickProjectFolder({ defaultPath: getWorkdir() });
      if (!projectPath) {
        res.json({ canceled: true });
        return;
      }
      const project = createOrTouchProject(projectPath);
      res.json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "选择项目失败" });
    }
  });

  router.post("/projects/pick-save-directory", async (_req: Request, res: Response) => {
    try {
      const selected = await pickProjectFolder({
        defaultPath: getDefaultGitSaveDirectory() || getWorkdir(),
        prompt: "选择 Git 仓库保存目录",
      });
      if (!selected) {
        res.json({ canceled: true });
        return;
      }
      res.json({ path: setDefaultGitSaveDirectory(selected) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "选择保存目录失败" });
    }
  });

  router.get("/projects/default-save-directory", (_req: Request, res: Response) => {
    const path = getDefaultGitSaveDirectory();
    res.json(path ? { path } : { path: null });
  });

  router.post("/projects/clone", async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      url?: unknown;
      parentPath?: unknown;
      projectName?: unknown;
      username?: unknown;
      password?: unknown;
    };
    try {
      const project = await cloneProjectFromGit({
        url: typeof body.url === "string" ? body.url : "",
        parentPath: typeof body.parentPath === "string" ? body.parentPath : "",
        projectName: typeof body.projectName === "string" ? body.projectName : "",
        username: typeof body.username === "string" ? body.username : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
      });
      res.json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "克隆项目失败" });
    }
  });

  router.post("/projects/clone/stream", async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      url?: unknown;
      parentPath?: unknown;
      projectName?: unknown;
      username?: unknown;
      password?: unknown;
    };

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    function writeEvent(event: Record<string, unknown>): void {
      if (res.writableEnded) return;
      res.write(JSON.stringify(event) + "\n");
    }

    try {
      const project = await cloneProjectFromGit({
        url: typeof body.url === "string" ? body.url : "",
        parentPath: typeof body.parentPath === "string" ? body.parentPath : "",
        projectName: typeof body.projectName === "string" ? body.projectName : "",
        username: typeof body.username === "string" ? body.username : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
        onProgress: (progress) => {
          writeEvent({ type: "progress", ...progress });
        },
      });
      writeEvent({ type: "done", project });
    } catch (error) {
      writeEvent({ type: "error", error: error instanceof Error ? error.message : "克隆项目失败" });
    } finally {
      res.end();
    }
  });

  router.get("/projects/git-credential", (req: Request, res: Response) => {
    const url = typeof req.query.url === "string" ? req.query.url : "";
    const credential = getSavedGitCredentialSummary(url);
    if (!credential) {
      res.json({ found: false });
      return;
    }
    res.json({ found: true, ...credential });
  });

  router.delete("/projects/:id", (req: Request, res: Response) => {
    const projectId = req.params.id as string;
    if (!db.getProject(projectId)) {
      res.status(404).json({ error: "项目不存在" });
      return;
    }

    if (!deleteProject(projectId)) {
      res.status(500).json({ error: "删除项目失败" });
      return;
    }

    res.json({ ok: true, projectId });
  });

  router.get("/projects/:id/tree", (req: Request, res: Response) => {
    const project = db.getProject(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: "项目不存在" });
      return;
    }

    try {
      const relativePath = typeof req.query.path === "string" ? req.query.path : "";
      res.json({
        projectId: project.id,
        path: relativePath,
        children: readProjectTree(project, relativePath),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "读取目录失败" });
    }
  });

  return router;
}
