import { Router } from "express";
import type { Request, Response } from "express";
import { getWorkdir } from "../../shared.js";
import * as db from "../db.js";
import {
  createOrTouchProject,
  pickProjectFolder,
  readProjectTree,
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
