import { Router } from "express";
import type { Request, Response } from "express";
import { getDataDir, readAppSettings, updateAppSettings, type AppSettings } from "../../app-settings.js";
import { logger, getLogDir } from "../../logger.js";
import { getWorkdir } from "../../shared.js";
import { openDirectory } from "../../utils/open-directory.js";
import { getUploadDir } from "../services/files.js";
import {
  clearWorkspaceFiles,
  migrateWorkspaceMemoryFiles,
  normalizeProjectPath,
  pickProjectFolder,
} from "../services/projects.js";

export function createSettingsRouter(): Router {
  const router = Router();

  router.get("/app-settings", (_req: Request, res: Response) => {
    try {
      res.json({
        settings: readAppSettings(),
        effective: {
          dataDir: getDataDir(),
          logDir: getLogDir(),
          workdir: getWorkdir(),
          uploadDir: getUploadDir(),
        },
      });
    } catch (error) {
      res.status(500).json({ error: "读取设置失败" });
    }
  });

  router.put("/app-settings", (req: Request, res: Response) => {
    try {
      const settings = req.body as Partial<AppSettings>;
      const previousWorkdir = getWorkdir();
      let requestedWorkdir: string | undefined;
      if (settings.workspace?.defaultWorkdir) {
        settings.workspace.defaultWorkdir = normalizeProjectPath(settings.workspace.defaultWorkdir);
        requestedWorkdir = settings.workspace.defaultWorkdir;
      }
      const next = updateAppSettings(settings);
      const migratedMemoryFiles = requestedWorkdir
        ? [
            ...migrateWorkspaceMemoryFiles(previousWorkdir, next.workspace.defaultWorkdir),
            ...migrateWorkspaceMemoryFiles(process.cwd(), next.workspace.defaultWorkdir),
          ]
        : [];
      if (migratedMemoryFiles.length > 0) {
        logger.info("workspace.memory_migrated", { from: previousWorkdir, to: next.workspace.defaultWorkdir, files: migratedMemoryFiles });
      }
      logger.info("app_settings.updated");
      res.json({
        settings: next,
        effective: {
          dataDir: getDataDir(),
          logDir: getLogDir(),
          workdir: getWorkdir(),
          uploadDir: getUploadDir(),
        },
        migratedMemoryFiles,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "保存设置失败" });
    }
  });

  router.post("/app-settings/default-workdir/pick", async (_req: Request, res: Response) => {
    try {
      const selected = await pickProjectFolder({
        defaultPath: getWorkdir(),
        prompt: "变更默认工作目录",
      });
      if (!selected) {
        res.json({ canceled: true });
        return;
      }
      res.json({ path: normalizeProjectPath(selected) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "选择默认工作目录失败" });
    }
  });

  router.post("/app-settings/default-workdir/open", (_req: Request, res: Response) => {
    try {
      const workdir = getWorkdir();
      openDirectory(workdir);
      res.json({ ok: true, path: workdir });
    } catch (error) {
      res.status(500).json({ error: "打开工作区文件夹失败" });
    }
  });

  router.delete("/app-settings/default-workdir", (_req: Request, res: Response) => {
    try {
      const workdir = getWorkdir();
      const removed = clearWorkspaceFiles(workdir);
      logger.info("workspace.cleared", { workdir, removed });
      res.json({ ok: true, removed });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "清空工作区失败" });
    }
  });

  return router;
}
