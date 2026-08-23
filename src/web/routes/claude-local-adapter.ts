import { Router } from "express";
import type { Request, Response } from "express";
import { handleClaudeLocalAdapterRequest } from "../services/claude-local-adapter.js";

// Claude Code 本地后端（llama / Ollama）适配层：清洗 messages 中间的 system 消息后透传。
// 供本机 Claude CLI/SDK 调用，token 豁免在 auth.ts 中与 codex-openai 同级处理。
export function createClaudeLocalAdapterRouter(): Router {
  const router = Router();

  // 用 use 做前缀匹配（Express 5 的 path-to-regexp 不接受裸 * 通配），全部方法透传
  router.use("/claude-local", (req: Request, res: Response) => {
    handleClaudeLocalAdapterRequest(req, res).catch((error) => {
      res.status(500).json({
        type: "error",
        error: {
          type: "server_error",
          message: error instanceof Error ? error.message : "Claude 本地适配层请求失败",
        },
      });
    });
  });

  return router;
}
