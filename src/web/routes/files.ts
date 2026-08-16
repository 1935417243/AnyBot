import { Router } from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { logger } from "../../logger.js";
import { openFile, revealFileInFolder } from "../../utils/open-directory.js";
import * as db from "../db.js";
import { getUploadDir, isHtmlFile, isImageFile, listMentionableFiles, resolveLocalFilePath } from "../services/files.js";
import { getSessionWorkdir } from "../services/projects.js";

function getUploadDateDir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getUploadFileExtension(originalName: string): string {
  const ext = path.extname(path.basename(originalName || ""));
  return ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 24);
}

function getAvailableUploadFilename(uploadDir: string, originalName: string): string {
  const ext = getUploadFileExtension(originalName);

  for (;;) {
    const random = Math.random().toString(36).slice(2, 10);
    const candidate = `${Date.now()}${random}${ext}`;
    if (!fs.existsSync(path.join(uploadDir, candidate))) {
      return candidate;
    }
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(getUploadDir(), getUploadDateDir());
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, getAvailableUploadFilename(path.join(getUploadDir(), getUploadDateDir()), file.originalname));
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

export function createFilesRouter(): Router {
  const router = Router();

  router.post("/upload", upload.single("file"), (req: Request, res: Response) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "未收到文件" });
      return;
    }
    const absPath = path.resolve(file.path);
    logger.info("web.upload.success", { name: file.originalname, path: absPath, size: file.size });
    res.json({
      path: absPath,
      name: file.originalname,
      size: file.size,
      isImage: isImageFile(file.originalname),
    });
  });

  router.get("/local-file", (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: "缺少 path 参数" });
      return;
    }
    if (!isImageFile(filePath)) {
      res.status(403).json({ error: "只允许访问图片文件" });
      return;
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: "文件不存在" });
      return;
    }
    res.sendFile(resolved);
  });

  router.post("/local-file/open", async (req: Request, res: Response) => {
    const filePath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!filePath) {
      res.status(400).json({ error: "缺少 path 参数" });
      return;
    }

    let resolved: string;
    try {
      resolved = resolveLocalFilePath(filePath);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "路径无效" });
      return;
    }

    if (!isHtmlFile(resolved)) {
      res.status(403).json({ error: "只允许打开 HTML 文件" });
      return;
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        res.status(404).json({ error: "文件不存在" });
        return;
      }
      await openFile(resolved);
      res.json({ ok: true, path: resolved });
    } catch (error) {
      res.status(fs.existsSync(resolved) ? 500 : 404).json({
        error: fs.existsSync(resolved)
          ? (error instanceof Error ? error.message : "打开文件失败")
          : "文件不存在",
      });
    }
  });

  router.post("/local-file/reveal", async (req: Request, res: Response) => {
    const filePath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!filePath) {
      res.status(400).json({ error: "缺少 path 参数" });
      return;
    }

    let resolved: string;
    try {
      resolved = resolveLocalFilePath(filePath);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "路径无效" });
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      res.json({ ok: true, path: resolved, skipped: true });
      return;
    }

    if (!stat.isDirectory() && !stat.isFile()) {
      res.json({ ok: true, path: resolved, skipped: true });
      return;
    }

    const directory = stat.isDirectory() ? resolved : path.dirname(resolved);
    try {
      if (stat.isDirectory()) {
        await openFile(resolved);
      } else {
        await revealFileInFolder(resolved);
      }
      res.json({ ok: true, path: resolved, directory });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "打开文件夹失败" });
    }
  });

  router.get("/files/mentions", async (req: Request, res: Response) => {
    const raw = req.query.projectId;
    const projectId = typeof raw === "string" && raw ? raw : null;
    if (projectId && !db.getProject(projectId)) {
      res.json({ files: [] });
      return;
    }

    try {
      const workdir = getSessionWorkdir({ projectId });
      const files = await listMentionableFiles(workdir, {
        allowWorkspaceScan: !projectId,
        excludeDefaultWorkspaceDirs: !projectId,
      });
      res.json({ files });
    } catch (error) {
      logger.warn("web.files.mention_list_failed", { projectId, error });
      res.json({ files: [] });
    }
  });

  router.get("/sessions/:id/files/mentions", async (req: Request, res: Response) => {
    const session = db.getSessionMetadata(req.params.id as string);
    if (!session) {
      res.json({ files: [] });
      return;
    }

    try {
      const workdir = getSessionWorkdir(session);
      const files = await listMentionableFiles(workdir, {
        allowWorkspaceScan: !session.projectId,
        excludeDefaultWorkspaceDirs: !session.projectId,
      });
      res.json({ files });
    } catch (error) {
      logger.warn("web.files.mention_list_failed", { sessionId: session.id, error });
      res.json({ files: [] });
    }
  });

  return router;
}
