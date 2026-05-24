import { Router } from "express";
import type { Request, Response } from "express";
import { getProvider } from "../../providers/index.js";
import { generateId } from "../../shared.js";
import { getActiveRunInfo } from "../active-runs.js";
import { getActiveAgentStreamInfo } from "../agent-stream.js";
import * as db from "../db.js";
import { emitSessionsChanged } from "../events.js";
import { prepareMessagesForClient, readMessagePageQuery } from "../services/messages.js";

export function createSessionsRouter(): Router {
  const router = Router();

  router.get("/sessions", (_req: Request, res: Response) => {
    const list = db.listSessions();
    res.json(list);
  });

  router.post("/sessions", (req: Request, res: Response) => {
    const { projectId } = req.body as { projectId?: string | null };
    if (projectId && !db.getProject(projectId)) {
      res.status(404).json({ error: "项目不存在" });
      return;
    }

    const session: db.ChatSession = {
      id: generateId(),
      title: "新对话",
      sessionId: null,
      provider: getProvider().type,
      source: "web",
      chatId: null,
      projectId: projectId || null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.createSession(session);
    emitSessionsChanged(session.id, "session_created");
    res.json({
      id: session.id,
      title: session.title,
      projectId: session.projectId,
      provider: session.provider,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });

  router.get("/sessions/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    const page = db.getMessagesPage(id, readMessagePageQuery(req));
    res.json({
      id: session.id,
      title: session.title,
      provider: session.provider,
      source: session.source,
      projectId: session.projectId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: await prepareMessagesForClient(page.messages),
      hasMoreMessages: page.hasMore,
      activeRun: getActiveRunInfo(session.id),
      activeStream: getActiveAgentStreamInfo(session.id),
    });
  });

  router.get("/sessions/:id/messages", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    const page = db.getMessagesPage(id, readMessagePageQuery(req));
    res.json({
      messages: await prepareMessagesForClient(page.messages),
      hasMoreMessages: page.hasMore,
    });
  });

  router.get("/sessions/:id/messages/:messageId/content", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      res.status(400).json({ error: "消息 ID 无效" });
      return;
    }
    const session = db.getSessionMetadata(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    const content = db.getMessageContent(id, Math.floor(messageId));
    if (content == null) {
      res.status(404).json({ error: "消息不存在" });
      return;
    }
    res.json({ content });
  });

  router.delete("/sessions/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    db.deleteSession(id);
    emitSessionsChanged(id, "session_deleted");
    res.json({ ok: true });
  });

  return router;
}
