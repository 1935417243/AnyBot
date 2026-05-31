import type { Request } from "express";
import type { ClaudeAgentStreamEvent } from "../../providers/claude-code-agent-events.js";
import { compactAgentEvents } from "../agent-stream.js";
import { getChangeReview } from "../change-review.js";
import * as db from "../db.js";

const DEFAULT_SESSION_MESSAGE_LIMIT = 40;
const MESSAGE_PREVIEW_CHARS = 20000;

type ClientChatMessage = db.ChatMessage & {
  contentTruncated?: boolean;
  contentChars?: number;
};

function hasCompletedDurationEvent(events: ClaudeAgentStreamEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "agent_status" &&
      event.status === "completed" &&
      typeof event.durationMs === "number" &&
      Number.isFinite(event.durationMs),
  );
}

function inferAssistantDurationMs(
  messages: db.ChatSession["messages"],
  index: number,
  assistantCreatedAt: number,
): number | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const durationMs = assistantCreatedAt - message.createdAt;
    return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
  }
  return null;
}

function ensureCodexCompletedDurationEvent(
  messages: db.ChatSession["messages"],
  index: number,
  message: db.ChatMessage,
  provider: string,
  events: ClaudeAgentStreamEvent[],
): ClaudeAgentStreamEvent[] {
  if (provider !== "codex" || hasCompletedDurationEvent(events)) return events;

  const durationMs = inferAssistantDurationMs(messages, index, message.createdAt);
  if (durationMs === null) return events;

  return [
    ...events,
    {
      type: "agent_status",
      status: "completed",
      message: "Codex Agent 已完成",
      durationMs,
    },
  ];
}

export function readMessagePageQuery(req: Request): { beforeId: number | null; limit: number } {
  const beforeRaw = Array.isArray(req.query.before) ? req.query.before[0] : req.query.before;
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const before = beforeRaw ? Number(beforeRaw) : null;
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_SESSION_MESSAGE_LIMIT;
  return {
    beforeId: before && Number.isFinite(before) && before > 0 ? Math.floor(before) : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_SESSION_MESSAGE_LIMIT,
  };
}

export async function prepareMessagesForClient(
  messages: db.ChatMessage[],
): Promise<ClientChatMessage[]> {
  const hydrated = await hydrateChangeReviewMetadata(messages);
  return hydrated.map((message, index) => {
    let metadata = message.metadata;
    if (metadata) {
      try {
        const parsed = JSON.parse(metadata) as Record<string, unknown>;
        const loop = parsed.claudeAgentLoop as { provider?: string; events?: ClaudeAgentStreamEvent[] } | undefined;
        if (loop && Array.isArray(loop.events)) {
          const provider = loop.provider || (typeof parsed.provider === "string" ? parsed.provider : "");
          const events = ensureCodexCompletedDurationEvent(
            hydrated,
            index,
            message,
            provider,
            loop.events,
          );
          parsed.claudeAgentLoop = {
            ...loop,
            events: compactAgentEvents(events),
          };
          metadata = JSON.stringify(parsed);
        }
      } catch {
        metadata = message.metadata;
      }
    }

    if (message.content.length <= MESSAGE_PREVIEW_CHARS) {
      return { ...message, metadata };
    }

    return {
      ...message,
      metadata,
      content: `${message.content.slice(0, MESSAGE_PREVIEW_CHARS)}\n\n...[内容较长，已折叠]`,
      contentTruncated: true,
      contentChars: message.content.length,
    };
  });
}

async function hydrateChangeReviewMetadata(
  messages: db.ChatSession["messages"],
): Promise<db.ChatSession["messages"]> {
  return Promise.all(
    messages.map(async (message) => {
      if (!message.metadata) return message;
      try {
        const metadata = JSON.parse(message.metadata) as Record<string, unknown>;
        const existing = metadata.changeReview as { id?: string } | undefined;
        if (!existing?.id) return message;
        const hydrated = await getChangeReview(existing.id);
        return {
          ...message,
          metadata: JSON.stringify({ ...metadata, changeReview: hydrated }),
        };
      } catch {
        return message;
      }
    }),
  );
}
