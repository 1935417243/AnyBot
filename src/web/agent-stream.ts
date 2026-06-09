import type { Response } from "express";
import type { ClaudeAgentStreamEvent } from "../providers/claude-code-agent-events.js";
import type { CodexAnswerDoneEvent, ProviderContextUsage } from "../providers/types.js";
import type { PublicChangeReview } from "./change-review.js";

const MAX_PERSISTED_AGENT_EVENTS = 240;
const MAX_PERSISTED_EVENT_TEXT = 2000;
const MAX_PERSISTED_DIFF_TEXT = 4000;
const MAX_PERSISTED_THINKING_TEXT = 4000;
const MAX_PERSISTED_SHELL_COMMAND_TEXT = 300;
const MAX_CLIENT_EVENT_TEXT = 4000;
const MAX_CLIENT_DIFF_TEXT = 4000;
const MAX_CLIENT_TASK_TEXT = 1200;
const MAX_CLIENT_DELTA_TEXT = 8000;

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
  clientThinkingChars: number;
  clientThinkingTruncated: boolean;
  clientProcessChars: number;
  clientProcessTruncated: boolean;
};

const activeAgentStreams = new Map<string, ActiveAgentStream>();

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function truncateForHistory(value: string | undefined, max = MAX_PERSISTED_EVENT_TEXT): string | undefined {
  if (!value) return value;
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function truncateForClient(value: string | undefined, max = MAX_CLIENT_EVENT_TEXT): { text?: string; truncated: boolean } {
  if (!value) return { text: value, truncated: false };
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

function truncateDeltaForClient(
  active: ActiveAgentStream,
  event: Extract<ClaudeAgentStreamEvent, { type: "thinking_delta" | "process_delta" }>,
): ClaudeAgentStreamEvent | null {
  const text = event.text || "";
  if (!text) return null;
  const isThinking = event.type === "thinking_delta";
  const used = isThinking ? active.clientThinkingChars : active.clientProcessChars;
  const alreadyTruncated = isThinking ? active.clientThinkingTruncated : active.clientProcessTruncated;
  const remaining = MAX_CLIENT_DELTA_TEXT - used;

  if (remaining <= 0) {
    if (alreadyTruncated) return null;
    if (isThinking) {
      active.clientThinkingTruncated = true;
    } else {
      active.clientProcessTruncated = true;
    }
    return { ...event, text: "\n\n...[过程较长，已折叠]" };
  }

  if (text.length <= remaining) {
    if (isThinking) {
      active.clientThinkingChars += text.length;
    } else {
      active.clientProcessChars += text.length;
    }
    return event;
  }

  if (isThinking) {
    active.clientThinkingChars = MAX_CLIENT_DELTA_TEXT;
    active.clientThinkingTruncated = true;
  } else {
    active.clientProcessChars = MAX_CLIENT_DELTA_TEXT;
    active.clientProcessTruncated = true;
  }
  return { ...event, text: `${text.slice(0, remaining)}\n\n...[过程较长，已折叠]` };
}

function compactToolEndEventForClient(event: Extract<ClaudeAgentStreamEvent, { type: "tool_end" }>): ClaudeAgentStreamEvent {
  const stdout = truncateForClient(event.output?.stdout);
  const stderr = truncateForClient(event.output?.stderr);
  const text = truncateForClient(event.output?.text);
  const error = truncateForClient(event.error);

  return {
    ...event,
    output: event.output
      ? {
          stdout: stdout.text,
          stderr: stderr.text,
          text: text.text,
          stdoutTruncated: stdout.truncated || undefined,
          stderrTruncated: stderr.truncated || undefined,
          textTruncated: text.truncated || undefined,
        }
      : undefined,
    error: error.text,
    errorTruncated: error.truncated || undefined,
    diffs: event.diffs?.map((diff) => {
      const compact = truncateForClient(diff.diff, MAX_CLIENT_DIFF_TEXT);
      return {
        ...diff,
        diff: compact.text || "",
        diffTruncated: diff.diffTruncated || compact.truncated || undefined,
      };
    }),
  };
}

function truncateShellCommandForHistory(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.length <= MAX_PERSISTED_SHELL_COMMAND_TEXT) return value;
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.slice(0, MAX_PERSISTED_SHELL_COMMAND_TEXT);
}

function compactToolStartEvent(event: Extract<ClaudeAgentStreamEvent, { type: "tool_start" }>): ClaudeAgentStreamEvent {
  const isLongBashCommand =
    event.tool.name === "Bash" &&
    [event.tool.summary, event.tool.input].some((value) =>
      typeof value === "string" && value.length > MAX_PERSISTED_SHELL_COMMAND_TEXT
    );

  if (!isLongBashCommand) {
    return {
      ...event,
      tool: {
        ...event.tool,
        input: truncateForHistory(event.tool.input),
      },
    };
  }

  const summary = truncateShellCommandForHistory(event.tool.summary)
    || truncateShellCommandForHistory(event.tool.input)
    || "";

  return {
    ...event,
    tool: {
      ...event.tool,
      title: summary ? `${event.tool.name} · ${summary}` : event.tool.name,
      summary,
      input: truncateShellCommandForHistory(event.tool.input),
      commandTruncated: true,
    },
  };
}

function compactAgentEvent(event: ClaudeAgentStreamEvent): ClaudeAgentStreamEvent | null {
  if (event.type === "answer_delta" || event.type === "process_delta" || event.type === "tool_progress") return null;
  if (event.type === "thinking_delta") return null;
  if (event.type === "tool_start") {
    return compactToolStartEvent(event);
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

function compactAgentEventForClient(active: ActiveAgentStream, event: AgentStreamEvent): AgentStreamEvent | null {
  if (event.type === "thinking_delta" || event.type === "process_delta") {
    return truncateDeltaForClient(active, event);
  }
  if (event.type === "tool_start" && event.tool.name === "Bash") {
    return compactToolStartEvent(event);
  }
  if (event.type === "tool_end") {
    return compactToolEndEventForClient(event);
  }
  if (event.type === "task_start") {
    return {
      ...event,
      task: {
        ...event.task,
        description: truncateForClient(event.task.description, MAX_CLIENT_TASK_TEXT).text || "",
        prompt: truncateForClient(event.task.prompt, MAX_CLIENT_TASK_TEXT).text,
      },
    };
  }
  if (event.type === "task_progress") {
    return {
      ...event,
      description: truncateForClient(event.description, MAX_CLIENT_TASK_TEXT).text,
      summary: truncateForClient(event.summary, MAX_CLIENT_TASK_TEXT).text,
      error: truncateForClient(event.error, MAX_CLIENT_TASK_TEXT).text,
    };
  }
  if (event.type === "task_end") {
    return {
      ...event,
      summary: truncateForClient(event.summary, MAX_CLIENT_TASK_TEXT).text,
      outputFile: truncateForClient(event.outputFile, MAX_CLIENT_TASK_TEXT).text,
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

  const flushThinking = () => {
    if (!pendingThinking) return;
    compacted.push({
      type: "thinking_delta",
      text: pendingThinking,
    });
    pendingThinking = "";
  };

  for (const event of events) {
    if (event.type === "thinking_delta") {
      const remaining = MAX_PERSISTED_THINKING_TEXT - pendingThinking.length;
      if (remaining <= 0) {
        continue;
      }
      if (event.text.length <= remaining) {
        pendingThinking += event.text;
      } else {
        pendingThinking += event.text.slice(0, remaining);
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
  contextUsage?: ProviderContextUsage | null;
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
  if (opts.contextUsage) {
    metadata.contextUsage = opts.contextUsage;
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
    clientThinkingChars: 0,
    clientThinkingTruncated: false,
    clientProcessChars: 0,
    clientProcessTruncated: false,
  };
  activeAgentStreams.set(sessionId, active);
  return active;
}

export function emitAgentStream(active: ActiveAgentStream, event: AgentStreamEvent): void {
  const clientEvent = compactAgentEventForClient(active, event);
  if (!clientEvent) return;
  active.events.push(clientEvent);
  for (const client of active.clients) {
    if (client.writableEnded) continue;
    writeSse(client, clientEvent.type, clientEvent);
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
