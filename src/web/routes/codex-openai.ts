import { Router } from "express";
import type { Request, Response } from "express";
import {
  handleCodexResponsesRequest,
  listCodexAdapterModels,
} from "../services/codex-openai-adapter.js";

export function createCodexOpenAIRouter(): Router {
  const router = Router();

  router.post("/codex-openai/v1/responses", (req: Request, res: Response) => {
    handleCodexResponsesRequest(req, res).catch((error) => {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : "Codex 适配层请求失败",
          type: "server_error",
          code: "adapter_error",
        },
      });
    });
  });
  router.post("/codex-openai/responses", (req: Request, res: Response) => {
    handleCodexResponsesRequest(req, res).catch((error) => {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : "Codex 适配层请求失败",
          type: "server_error",
          code: "adapter_error",
        },
      });
    });
  });

  router.get("/codex-openai/v1/models", (_req: Request, res: Response) => {
    res.json(listCodexAdapterModels());
  });
  router.get("/codex-openai/models", (_req: Request, res: Response) => {
    res.json(listCodexAdapterModels());
  });

  return router;
}
