import {
  sanitizeAgentText,
  type ClaudeAgentStreamEvent,
} from "./providers/claude-code-agent-events.js";

type CodexAdapterStreamHandler = (event: ClaudeAgentStreamEvent) => void | Promise<void>;

const streamHandlers = new Map<string, Set<CodexAdapterStreamHandler>>();

export function registerCodexAdapterStream(
  runId: string,
  handler: CodexAdapterStreamHandler,
): () => void {
  let handlers = streamHandlers.get(runId);
  if (!handlers) {
    handlers = new Set();
    streamHandlers.set(runId, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      streamHandlers.delete(runId);
    }
  };
}

export function publishCodexAdapterStreamEvent(
  runId: string,
  event: ClaudeAgentStreamEvent,
): void {
  const handlers = streamHandlers.get(runId);
  if (!handlers) return;
  const safeEvent = sanitizeStreamEvent(event);
  for (const handler of handlers) {
    Promise.resolve(handler(safeEvent)).catch(() => {
      // Streaming side-channel failures must not break the Codex HTTP response.
    });
  }
}

function sanitizeStreamEvent(event: ClaudeAgentStreamEvent): ClaudeAgentStreamEvent {
  if (event.type === "answer_delta" || event.type === "thinking_delta") {
    return { ...event, text: sanitizeAgentText(event.text) };
  }
  return event;
}
