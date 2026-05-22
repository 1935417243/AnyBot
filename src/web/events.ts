import type { Response } from "express";

type WebUiEvent =
  | {
      type: "sessions_changed";
      sessionId?: string;
      reason?: string;
      updatedAt: number;
    }
  | {
      type: "projects_changed";
      projectId?: string;
      reason?: string;
      updatedAt: number;
    }
  | {
      type: "history_cleared";
      updatedAt: number;
    }
  | {
      type: "ready" | "ping";
      updatedAt: number;
    };

const clients = new Set<Response>();
const HEARTBEAT_INTERVAL_MS = 30_000;

function writeWebUiEvent(res: Response, event: WebUiEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event: WebUiEvent): void {
  for (const client of clients) {
    if (client.writableEnded) continue;
    writeWebUiEvent(client, event);
  }
}

export function attachWebUiEventClient(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  clients.add(res);
  writeWebUiEvent(res, { type: "ready", updatedAt: Date.now() });

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    writeWebUiEvent(res, { type: "ping", updatedAt: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

export function emitSessionsChanged(sessionId?: string, reason?: string): void {
  broadcast({
    type: "sessions_changed",
    sessionId,
    reason,
    updatedAt: Date.now(),
  });
}

export function emitProjectsChanged(projectId?: string, reason?: string): void {
  broadcast({
    type: "projects_changed",
    projectId,
    reason,
    updatedAt: Date.now(),
  });
}

export function emitHistoryCleared(): void {
  broadcast({
    type: "history_cleared",
    updatedAt: Date.now(),
  });
}
