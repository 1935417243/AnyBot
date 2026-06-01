import { Router } from "express";
import type { Request, Response } from "express";
import { getProvider } from "../../providers/index.js";
import { generateId } from "../../shared.js";
import { getActiveRunInfo } from "../active-runs.js";
import { getActiveAgentStreamInfo } from "../agent-stream.js";
import * as db from "../db.js";
import { emitSessionsChanged } from "../events.js";
import { prepareMessagesForClient, readMessagePageQuery } from "../services/messages.js";

const DEFAULT_SESSION_LIST_LIMIT = 40;

function readStringQuery(value: Request["query"][string]): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

function encodeSessionCursor(session: db.SessionSummary): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: Number(session.updatedAt || 0),
      createdAt: Number(session.createdAt || 0),
      id: session.id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeSessionCursor(value: string): db.SessionListCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<db.SessionListCursor>;
    const updatedAt = Number(parsed.updatedAt);
    const createdAt = Number(parsed.createdAt);
    const id = typeof parsed.id === "string" ? parsed.id : "";
    if (!Number.isFinite(updatedAt) || !Number.isFinite(createdAt) || !id) return null;
    return { updatedAt, createdAt, id };
  } catch {
    return null;
  }
}

export function createSessionsRouter(): Router {
  const router = Router();

  router.get("/sessions", (req: Request, res: Response) => {
    const limitRaw = readStringQuery(req.query.limit);
    if (!limitRaw) {
      const list = db.listSessions();
      res.json(list);
      return;
    }

    const limit = Number(limitRaw);
    if (!Number.isFinite(limit) || limit <= 0) {
      res.status(400).json({ error: "分页大小无效" });
      return;
    }

    const scope = readStringQuery(req.query.scope);
    const projectId = readStringQuery(req.query.projectId);

    const cursorRaw = readStringQuery(req.query.cursor);
    const cursor = cursorRaw ? decodeSessionCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      res.status(400).json({ error: "分页游标无效" });
      return;
    }

    const page = db.listSessionsPage({
      limit: Math.floor(limit || DEFAULT_SESSION_LIST_LIMIT),
      cursor,
      ...(scope === "global" ? { projectId: null } : projectId ? { projectId } : {}),
    });
    const last = page.items[page.items.length - 1] || null;
    res.json({
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.hasMore && last ? encodeSessionCursor(last) : null,
    });
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
      source: session.source,
      messageCount: 0,
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
      messages: await prepareMessagesForClient(page.messages, {
        provider: session.provider,
        providerSessionId: session.sessionId,
        hydrateLatestContextUsage: true,
      }),
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
