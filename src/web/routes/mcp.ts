import { Router } from "express";
import type { Request, Response } from "express";
import {
  addMcpServersFromJson,
  checkMcpServer,
  deleteMcpServer,
  getMcpServerLogs,
  listMcpServers,
  refreshMcpServers,
  setMcpServerEnabled,
  updateMcpServerFromJson,
} from "../services/mcp.js";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export function createMcpRouter(): Router {
  const router = Router();

  async function handleCheckServer(req: Request, res: Response): Promise<void> {
    try {
      res.json({ servers: await checkMcpServer(getRouteParam(req.params.id)) });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, "检查 MCP Server 失败") });
    }
  }

  router.get("/mcp/servers", (_req: Request, res: Response) => {
    try {
      res.json({ servers: listMcpServers() });
    } catch (error) {
      res.status(500).json({ error: "读取 MCP Servers 失败" });
    }
  });

  router.post("/mcp/servers/refresh", async (_req: Request, res: Response) => {
    try {
      res.json({ servers: await refreshMcpServers() });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error, "刷新 MCP Servers 失败") });
    }
  });

  router.post("/mcp/servers", async (req: Request, res: Response) => {
    try {
      const json = typeof req.body?.json === "string" ? req.body.json : "";
      res.json({ servers: await addMcpServersFromJson(json) });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, "添加 MCP Server 失败") });
    }
  });

  router.put("/mcp/servers/:id", async (req: Request, res: Response) => {
    try {
      const json = typeof req.body?.json === "string" ? req.body.json : "";
      res.json({ servers: await updateMcpServerFromJson(getRouteParam(req.params.id), json) });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, "保存 MCP Server 失败") });
    }
  });

  router.patch("/mcp/servers/:id/enabled", async (req: Request, res: Response) => {
    try {
      if (typeof req.body?.enabled !== "boolean") {
        res.status(400).json({ error: "缺少 enabled" });
        return;
      }
      res.json({ servers: await setMcpServerEnabled(getRouteParam(req.params.id), req.body.enabled) });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, "切换 MCP Server 失败") });
    }
  });

  router.post("/mcp/servers/:id/check", handleCheckServer);
  router.post("/mcp/servers/:id/restart", handleCheckServer);

  router.get("/mcp/servers/:id/logs", (req: Request, res: Response) => {
    try {
      res.json({ logs: getMcpServerLogs(getRouteParam(req.params.id)) });
    } catch (error) {
      res.status(500).json({ error: "读取 MCP Server 日志失败" });
    }
  });

  router.delete("/mcp/servers/:id", (req: Request, res: Response) => {
    try {
      res.json({ servers: deleteMcpServer(getRouteParam(req.params.id)) });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, "删除 MCP Server 失败") });
    }
  });

  return router;
}
