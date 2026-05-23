import { Router } from "express";
import type { Request, Response } from "express";
import { proxyDesktopUpdate } from "../services/desktop-update.js";

export function createDesktopUpdateRouter(): Router {
  const router = Router();

  router.get("/desktop-update/status", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/status", "GET", res);
  });

  router.post("/desktop-update/check", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/check", "POST", res);
  });

  router.post("/desktop-update/download", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/download", "POST", res);
  });

  router.post("/desktop-update/restart", async (_req: Request, res: Response) => {
    await proxyDesktopUpdate("/restart", "POST", res);
  });

  return router;
}
