import type { Response } from "express";
import type { ClaudeAgentStreamEvent } from "../providers/claude-code-agent-events.js";
import type { CodexAnswerDoneEvent, ProviderContextUsage } from "../providers/types.js";
import type { PublicChangeReview } from "./change-review.js";

const MAX_PERSISTED_AGENT_EVENTS = 240;
const MAX_PERSISTED_EVENT_TEXT = 2000;
const MAX_PERSISTED_DIFF_TEXT = 4000;
const MAX_PERSISTED_THINKING_TEXT = 4000;

export type AgentStreamEvent =
  | ClaudeAgentStreamEvent
  | CodexAnswerDoneEvent
  | {
      type: "result";
      content: string;
      title: string;
      sessionId: string | null;
      provider?: string | null;
      changeReview?: PublicChangeReview | null;
      contextUsage?: ProviderContextUsage;
    }
  | { type: "error"; error: string }
  | { type: "cancelled"; message?: string }
  | { type: "done" };

type ActiveAgentStream = {
  events: AgentStreamEvent[];
  clients: Set<Response>;
  startedAt: number;
  done: boolean;
};

const activeAgentStreams = new Map<string, ActiveAgentStream>();

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function truncateForHistory(value: string | undefined, max = MAX_PERSISTED_EVENT_TEXT): string | undefined {
  if (!value) return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[已截断 ${value.length - max} 字符]`;
}

function compactAgentEvent(event: ClaudeAgentStreamEvent): ClaudeAgentStreamEvent | null {
  if (event.type === "answer_delta" || event.type === "process_delta" || event.type === "tool_progress") return null;
  if (event.type === "thinking_delta") return null;
  if (event.type === "tool_start") {
    return {
      ...event,
      tool: {
        ...event.tool,
        input: truncateForHistory(event.tool.input),
      },
    };
  }
  if (event.type === "tool_end") {
    return {
      ...event,
      output: event.output
        ? {
            stdout: truncateForHistory(event.output.stdout),
            stderr: truncateForHistory(event.output.stderr),
            text: truncateForHistory(event.output.text),
          }
        : undefined,
      error: truncateForHistory(event.error),
      diffs: event.diffs?.map((diff) => ({
        ...diff,
        diff: truncateForHistory(diff.diff, MAX_PERSISTED_DIFF_TEXT) || "",
      })),
    };
  }
  if (event.type === "task_start") {
    return {
      ...event,
      task: {
        ...event.task,
        description: truncateForHistory(event.task.description) || "",
        prompt: truncateForHistory(event.task.prompt),
      },
    };
  }
  if (event.type === "task_progress") {
    return {
      ...event,
      description: truncateForHistory(event.description),
      summary: truncateForHistory(event.summary),
      error: truncateForHistory(event.error),
    };
  }
  if (event.type === "task_end") {
    return {
      ...event,
      summary: truncateForHistory(event.summary),
      outputFile: truncateForHistory(event.outputFile),
    };
  }
  if (event.type === "file_change") {
    return { ...event, diff: undefined };
  }
  return event;
}

export function compactAgentEvents(events: ClaudeAgentStreamEvent[]): ClaudeAgentStreamEvent[] {
  const compacted: ClaudeAgentStreamEvent[] = [];
  let pendingThinking = "";
  let pendingThinkingOmitted = 0;

  const flushThinking = () => {
    if (!pendingThinking) return;
    compacted.push({
      type: "thinking_delta",
      text:
        pendingThinkingOmitted > 0
          ? `${pendingThinking}\n...[已截断 ${pendingThinkingOmitted} 字符]`
          : pendingThinking,
    });
    pendingThinking = "";
    pendingThinkingOmitted = 0;
  };

  for (const event of events) {
    if (event.type === "thinking_delta") {
      const remaining = MAX_PERSISTED_THINKING_TEXT - pendingThinking.length;
      if (pendingThinkingOmitted > 0) {
        pendingThinkingOmitted += event.text.length;
      } else if (event.text.length <= remaining) {
        pendingThinking += event.text;
      } else {
        pendingThinking += event.text.slice(0, remaining);
        pendingThinkingOmitted += event.text.length - remaining;
      }
      continue;
    }

    flushThinking();
    const compact = compactAgentEvent(event);
    if (compact) compacted.push(compact);
  }

  flushThinking();
  return compacted.slice(-MAX_PERSISTED_AGENT_EVENTS);
}

export function buildAssistantMetadata(opts: {
  provider?: string;
  events?: ClaudeAgentStreamEvent[];
  changeReview?: PublicChangeReview | null;
}): string | null {
  const metadata: Record<string, unknown> = {};
  if (opts.provider) {
    metadata.provider = opts.provider;
  }
  if (opts.provider && opts.events) {
    metadata.claudeAgentLoop = {
      version: 1,
      provider: opts.provider,
      events: compactAgentEvents(opts.events),
    };
  }
  if (opts.changeReview) {
    metadata.changeReview = opts.changeReview;
  }
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

export function hasActiveAgentStream(sessionId: string): boolean {
  return activeAgentStreams.has(sessionId);
}

export function getActiveAgentStreamInfo(sessionId: string): { startedAt: number } | null {
  const active = activeAgentStreams.get(sessionId);
  return active ? { startedAt: active.startedAt } : null;
}

export function createActiveAgentStream(sessionId: string): ActiveAgentStream {
  const active: ActiveAgentStream = {
    events: [],
    clients: new Set(),
    startedAt: Date.now(),
    done: false,
  };
  activeAgentStreams.set(sessionId, active);
  return active;
}

export function emitAgentStream(active: ActiveAgentStream, event: AgentStreamEvent): void {
  active.events.push(event);
  for (const client of active.clients) {
    if (client.writableEnded) continue;
    writeSse(client, event.type, event);
  }
}

export function attachAgentStreamClient(sessionId: string, res: Response): boolean {
  const active = activeAgentStreams.get(sessionId);
  if (!active) return false;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  active.clients.add(res);
  res.on("close", () => {
    active.clients.delete(res);
  });

  for (const event of active.events) {
    if (res.writableEnded) break;
    writeSse(res, event.type, event);
  }

  if (active.done && !res.writableEnded) {
    res.end();
  }

  return true;
}

export function finishAgentStream(sessionId: string, active: ActiveAgentStream): void {
  if (!active.done) {
    active.done = true;
    emitAgentStream(active, { type: "done" });
  }
  for (const client of active.clients) {
    if (!client.writableEnded) client.end();
  }
  active.clients.clear();
  if (activeAgentStreams.get(sessionId) === active) {
    activeAgentStreams.delete(sessionId);
  }
}
