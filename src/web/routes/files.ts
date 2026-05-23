import { Router } from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { logger } from "../../logger.js";
import { getUploadDir, isImageFile } from "../services/files.js";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(getUploadDir(), { recursive: true });
    cb(null, getUploadDir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cb(null, `${base}-${unique}${ext}`);
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

  return router;
}
