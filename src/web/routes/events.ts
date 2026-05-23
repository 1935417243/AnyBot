import { Router } from "express";
import type { Request, Response } from "express";
import { attachWebUiEventClient } from "../events.js";

export function createEventsRouter(): Router {
  const router = Router();

  router.get("/events", (_req: Request, res: Response) => {
    attachWebUiEventClient(res);
  });

  return router;
}
