import { spawn } from "node:child_process";
import path from "node:path";
import type {
  HookInput,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { hasBinaryDiffFileType, shouldSuppressDiffFile } from "../diff-file-types.js";
import type { ProviderContextUsage } from "./types.js";

export type ClaudeAgentToolStatus = "running" | "success" | "failed";

/** 待办事项条目，与前端 todo_update 事件的结构一致 */
export type ClaudeAgentTodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
};

export type ClaudeAgentDiff = {
  path: string;
  diff: string;
  diffType: "text" | "binary";
  diffTruncated?: boolean;
};

const REALTIME_DIFF_MAX_BYTES = 32 * 1024;
const REALTIME_DIFF_MAX_LINES = 200;

export type ClaudeAgentStreamEvent =
  | {
      type: "agent_status";
      status: "started" | "running" | "completed" | "failed";
      message?: string;
      sessionId?: string;
      durationMs?: number;
    }
  | { type: "answer_delta"; text: string }
  | { type: "process_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | {
      type: "task_start";
      task: {
        id: string;
        toolUseId?: string;
        description: string;
        taskType?: string;
        workflowName?: string;
        prompt?: string;
        startedAt: number;
        status: "running";
      };
    }
  | {
      type: "task_progress";
      taskId: string;
      toolUseId?: string;
      description?: string;
      summary?: string;
      lastToolName?: string;
      status?: "pending" | "running" | "completed" | "failed" | "killed" | "paused";
      isBackgrounded?: boolean;
      error?: string;
      durationMs?: number;
      totalTokens?: number;
      toolUses?: number;
    }
  | {
      type: "task_end";
      taskId: string;
      toolUseId?: string;
      status: "completed" | "failed" | "stopped";
      outputFile?: string;
      summary?: string;
      durationMs?: number;
      totalTokens?: number;
      toolUses?: number;
    }
  | {
      type: "tool_start";
      tool: {
        id: string;
        name: string;
        title: string;
        summary: string;
        input?: string;
        commandTruncated?: boolean;
        files?: string[];
        startedAt: number;
        status: "running";
      };
    }
  | {
      type: "tool_progress";
      toolId: string;
      elapsedMs: number;
    }
  | {
      type: "tool_end";
      toolId: string;
      status: Exclude<ClaudeAgentToolStatus, "running">;
      durationMs?: number;
      output?: {
        stdout?: string;
        stderr?: string;
        text?: string;
        stdoutTruncated?: boolean;
        stderrTruncated?: boolean;
        textTruncated?: boolean;
      };
      error?: string;
      errorTruncated?: boolean;
      files?: string[];
      diffs?: ClaudeAgentDiff[];
    }
  | {
      type: "file_change";
      path: string;
      event: "change" | "add" | "unlink";
      diff?: string;
    }
  | {
      type: "todo_update";
      todos: ClaudeAgentTodoItem[];
    }
  | { type: "context_usage"; usage: ProviderContextUsage };

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
];

const SECRET_PREFIX_PATTERNS: RegExp[] = [
  /\b((?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"'`]+)/gi,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
];

export function sanitizeAgentText(value: unknown): string {
  let text = stringifyForDisplay(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  for (const pattern of SECRET_PREFIX_PATTERNS) {
    text = text.replace(pattern, (_match, prefix) => `${prefix}[REDACTED]`);
  }
  return text;
}

export function extractAssistantTextDelta(message: SDKMessage): string | null {
  if (message.type !== "stream_event") return null;
  const partial = message as SDKPartialAssistantMessage;
  const event = partial.event as {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  if (event.type !== "content_block_delta") return null;
  if (event.delta?.type !== "text_delta") return null;
  return event.delta.text ? sanitizeAgentText(event.delta.text) : null;
}

export function extractAssistantThinkingDelta(message: SDKMessage): string | null {
  if (message.type !== "stream_event") return null;
  const partial = message as SDKPartialAssistantMessage;
  const event = partial.event as {
    type?: string;
    delta?: { type?: string; thinking?: string };
  };
  if (event.type !== "content_block_delta") return null;
  if (event.delta?.type !== "thinking_delta") return null;
  return event.delta.thinking ? sanitizeAgentText(event.delta.thinking) : null;
}

export function createToolStartEvent(
  input: HookInput,
  workdir: string,
): ClaudeAgentStreamEvent | null {
  if (input.hook_event_name !== "PreToolUse") return null;
  const toolInput = input.tool_input;
  const summary = summarizeToolInput(input.tool_name, toolInput);
  const files = extractFilePaths(input.tool_name, toolInput)
    .map((file) => normalizeDisplayPath(file, workdir));
  return {
    type: "tool_start",
    tool: {
      id: input.tool_use_id,
      name: input.tool_name,
      title: buildToolTitle(input.tool_name, summary),
      summary,
      input: summarizeRawToolInput(input.tool_name, toolInput),
      files: files.length > 0 ? files : undefined,
      startedAt: Date.now(),
      status: "running",
    },
  };
}

export function createTodoUpdateEvent(
  input: HookInput,
): ClaudeAgentStreamEvent | null {
  if (input.hook_event_name !== "PreToolUse") return null;
  if (input.tool_name !== "TodoWrite") return null;
  const toolInput = input.tool_input;
  const todos = isRecord(toolInput) && Array.isArray(toolInput.todos) ? toolInput.todos : null;
  if (!todos) return null;
  const items = todos.flatMap((todo) => {
    if (!isRecord(todo)) return [];
    const content = sanitizeAgentText(
      getString(todo, "content") || getString(todo, "title") || "",
    );
    if (!content) return [];
    const rawStatus = (getString(todo, "status") || "").toLowerCase();
    const status =
      rawStatus === "in_progress"
        ? "in_progress"
        : rawStatus === "completed" || rawStatus === "done"
          ? "completed"
          : "pending";
    const activeForm = getString(todo, "activeForm");
    return [
      {
        content,
        status: status as "pending" | "in_progress" | "completed",
        activeForm: activeForm ? sanitizeAgentText(activeForm) : undefined,
      },
    ];
  });
  return { type: "todo_update", todos: items };
}

/**
 * 新版 SDK（0.3.x）用 TaskCreate/TaskUpdate 工具替代 TodoWrite 管理待办，
 * 单次调用只携带增量（创建一项 / 更新某 id 的状态），因此需要调用方跨 hook
 * 维护一份任务表（tasks），这里负责应用增量并输出全量 todo_update 事件。
 * 处理三种输入：TaskCreated hook、TaskCompleted hook、TaskUpdate 的 PreToolUse hook。
 */
export function createTaskTodoEvent(
  input: HookInput,
  tasks: Map<string, ClaudeAgentTodoItem>,
): ClaudeAgentStreamEvent | null {
  if (input.hook_event_name === "TaskCreated") {
    tasks.set(input.task_id, {
      content: sanitizeAgentText(input.task_subject),
      status: "pending",
    });
    return buildTaskTodoUpdateEvent(tasks);
  }

  if (input.hook_event_name === "TaskCompleted") {
    const task = tasks.get(input.task_id);
    if (task) task.status = "completed";
    else tasks.set(input.task_id, { content: sanitizeAgentText(input.task_subject), status: "completed" });
    return buildTaskTodoUpdateEvent(tasks);
  }

  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "TaskUpdate") return null;
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const taskId = getString(toolInput, "taskId") || getString(toolInput, "task_id");
  if (!taskId) return null;

  const rawStatus = (getString(toolInput, "status") || "").toLowerCase();
  if (rawStatus === "deleted") {
    tasks.delete(taskId);
    return buildTaskTodoUpdateEvent(tasks);
  }

  // resume 的会话可能更新历史任务，本地表里没有时按 subject 补建
  const task = tasks.get(taskId) ?? { content: "", status: "pending" as const };
  const subject = getString(toolInput, "subject");
  if (subject) task.content = sanitizeAgentText(subject);
  if (!task.content) task.content = `任务 ${taskId}`;
  if (rawStatus === "in_progress" || rawStatus === "completed" || rawStatus === "pending") {
    task.status = rawStatus;
  }
  const activeForm = getString(toolInput, "activeForm");
  if (activeForm) task.activeForm = sanitizeAgentText(activeForm);
  tasks.set(taskId, task);
  return buildTaskTodoUpdateEvent(tasks);
}

/** 把任务表序列化为全量 todo_update 事件（保持插入顺序） */
function buildTaskTodoUpdateEvent(
  tasks: Map<string, ClaudeAgentTodoItem>,
): ClaudeAgentStreamEvent {
  return { type: "todo_update", todos: [...tasks.values()].map((todo) => ({ ...todo })) };
}

export async function createToolEndEvent(
  input: HookInput,
  workdir: string,
): Promise<ClaudeAgentStreamEvent | null> {
  if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure") {
    return null;
  }

  const files = extractFilePaths(input.tool_name, input.tool_input);
  const diffs = await collectDiffs(workdir, files);

  if (input.hook_event_name === "PostToolUseFailure") {
    return {
      type: "tool_end",
      toolId: input.tool_use_id,
      status: "failed",
      durationMs: input.duration_ms,
      output: extractToolOutput(null),
      error: sanitizeAgentText(input.error),
      files,
      diffs,
    };
  }

  return {
    type: "tool_end",
    toolId: input.tool_use_id,
    status: "success",
    durationMs: input.duration_ms,
    output: extractToolOutput(input.tool_response),
    files,
    diffs,
  };
}

export async function createFileChangeEvent(
  input: HookInput,
  workdir: string,
): Promise<ClaudeAgentStreamEvent | null> {
  if (input.hook_event_name !== "FileChanged") return null;
  const diff = await collectDiff(workdir, input.file_path);
  return {
    type: "file_change",
    path: normalizeDisplayPath(input.file_path, workdir),
    event: input.event,
    diff: diff?.diff,
  };
}

export function createToolProgressEvent(message: SDKMessage): ClaudeAgentStreamEvent | null {
  if (message.type !== "tool_progress") return null;
  return {
    type: "tool_progress",
    toolId: message.tool_use_id,
    elapsedMs: Math.round(message.elapsed_time_seconds * 1000),
  };
}

export function createTaskEvent(
  message: SDKMessage,
  deniedTaskIds?: Set<string>,
): ClaudeAgentStreamEvent | null {
  if (message.type !== "system") return null;
  const subtype = (message as { subtype?: string }).subtype;

  // 子代理内工具被权限拒绝时记录任务 id（agent_id 与 task_id 一致），
  // 用于 task_notification 时把 completed 降级为 failed —— 子代理被拒绝了工具
  // 仍会正常跑完并上报 completed，但其目标未必达成（实测有的模型还会在 summary 里谎称成功）
  if (subtype === "permission_denied") {
    const denied = message as {
      agent_id?: string;
      tool_use_id: string;
      decision_reason?: string;
    };
    if (denied.agent_id) {
      deniedTaskIds?.add(denied.agent_id);
      return null;
    }
    // 主线程工具被拒绝时不会触发 PostToolUse 钩子，这里补发 tool_end，
    // 否则活动流里该工具行会一直停在运行中
    return {
      type: "tool_end",
      toolId: denied.tool_use_id,
      status: "failed",
      error: denied.decision_reason
        ? sanitizeAgentText(denied.decision_reason)
        : "工具调用被权限拒绝",
    };
  }

  if (subtype === "task_started") {
    const task = message as SDKTaskStartedMessage;
    if (task.skip_transcript) return null;
    return {
      type: "task_start",
      task: {
        id: task.task_id,
        toolUseId: task.tool_use_id,
        description: sanitizeAgentText(task.description),
        taskType: task.task_type,
        workflowName: task.workflow_name,
        prompt: task.prompt ? sanitizeAgentText(task.prompt) : undefined,
        startedAt: Date.now(),
        status: "running",
      },
    };
  }

  if (subtype === "task_progress") {
    const task = message as SDKTaskProgressMessage;
    return {
      type: "task_progress",
      taskId: task.task_id,
      toolUseId: task.tool_use_id,
      description: sanitizeAgentText(task.description),
      summary: task.summary ? sanitizeAgentText(task.summary) : undefined,
      lastToolName: task.last_tool_name,
      durationMs: task.usage?.duration_ms,
      totalTokens: task.usage?.total_tokens,
      toolUses: task.usage?.tool_uses,
    };
  }

  if (subtype === "task_updated") {
    const task = message as SDKTaskUpdatedMessage;
    return {
      type: "task_progress",
      taskId: task.task_id,
      status: task.patch.status,
      description: task.patch.description ? sanitizeAgentText(task.patch.description) : undefined,
      isBackgrounded: task.patch.is_backgrounded,
      error: task.patch.error ? sanitizeAgentText(task.patch.error) : undefined,
    };
  }

  if (subtype === "task_notification") {
    const task = message as SDKTaskNotificationMessage;
    if (task.skip_transcript) return null;
    const denied = task.status === "completed" && deniedTaskIds?.has(task.task_id);
    return {
      type: "task_end",
      taskId: task.task_id,
      toolUseId: task.tool_use_id,
      status: denied ? "failed" : task.status,
      outputFile: task.output_file,
      summary: denied
        ? `任务内有工具调用被权限拒绝，结果可能未完成。原始汇报：${sanitizeAgentText(task.summary)}`
        : sanitizeAgentText(task.summary),
      durationMs: task.usage?.duration_ms,
      totalTokens: task.usage?.total_tokens,
      toolUses: task.usage?.tool_uses,
    };
  }

  return null;
}

function buildToolTitle(toolName: string, summary: string): string {
  return summary ? `${toolName} · ${summary}` : toolName;
}

function summarizeToolInput(toolName: string, input: unknown): string {
  const obj = isRecord(input) ? input : {};
  const readPath = getString(obj, "file_path") || getString(obj, "path");
  switch (toolName) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return readPath ? path.basename(readPath) : "";
    case "Grep":
      return getString(obj, "pattern") || "";
    case "Glob":
      return getString(obj, "pattern") || "";
    case "LS":
      return readPath || "";
    case "Bash":
      return truncateOneLine(getString(obj, "command") || "", 96);
    case "Agent":
    case "Task":
      return getString(obj, "description") || getString(obj, "subagent_type") || "";
    default:
      return readPath || getString(obj, "command") || getString(obj, "pattern") || "";
  }
}

function summarizeRawToolInput(toolName: string, input: unknown): string {
  const obj = isRecord(input) ? input : input;
  if (toolName === "Write" && isRecord(obj) && typeof obj.content === "string") {
    return sanitizeAgentText({ ...obj, content: `[${obj.content.length} chars]` });
  }
  if ((toolName === "Edit" || toolName === "MultiEdit") && isRecord(obj)) {
    const compact = { ...obj };
    if (typeof compact.old_string === "string") compact.old_string = `[${compact.old_string.length} chars]`;
    if (typeof compact.new_string === "string") compact.new_string = `[${compact.new_string.length} chars]`;
    return sanitizeAgentText(compact);
  }
  return sanitizeAgentText(obj);
}

function extractToolOutput(response: unknown): { stdout?: string; stderr?: string; text?: string } | undefined {
  if (response == null) return undefined;
  if (isRecord(response)) {
    const stdout = getString(response, "stdout");
    const stderr = getString(response, "stderr");
    if (stdout || stderr) {
      return {
        stdout: stdout ? sanitizeAgentText(stdout) : undefined,
        stderr: stderr ? sanitizeAgentText(stderr) : undefined,
      };
    }
  }

  const text = sanitizeAgentText(response);
  return text ? { text } : undefined;
}

function extractFilePaths(toolName: string, input: unknown): string[] {
  const obj = isRecord(input) ? input : {};
  const paths = new Set<string>();
  const filePath = getString(obj, "file_path");
  const pathValue = getString(obj, "path");
  if (filePath) paths.add(filePath);
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName) && pathValue) {
    paths.add(pathValue);
  }
  return [...paths];
}

async function collectDiffs(workdir: string, files: string[]): Promise<ClaudeAgentDiff[]> {
  const diffs: ClaudeAgentDiff[] = [];
  for (const file of files) {
    const diff = await collectDiff(workdir, file);
    if (diff) {
      diffs.push({ path: normalizeDisplayPath(file, workdir), ...diff });
    }
  }
  return diffs;
}

async function collectDiff(
  workdir: string,
  file: string,
): Promise<{ diff: string; diffType: "text" | "binary"; diffTruncated?: boolean } | undefined> {
  if (shouldSuppressDiffFile(file)) return undefined;

  try {
    const preview = await runGitDiffPreview(workdir, file);
    const diff = sanitizeAgentText(preview.diff).trimEnd();
    if (!diff) return undefined;
    if (hasBinaryDiffFileType(file)) {
      return { diff: "", diffType: "binary" };
    }
    const diffType = /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/.test(diff)
      ? "binary"
      : "text";
    return {
      diff: diffType === "binary" ? "" : diff,
      diffType,
      diffTruncated: diffType === "text" && preview.truncated ? true : undefined,
    };
  } catch {
    return undefined;
  }
}

async function runGitDiffPreview(
  workdir: string,
  file: string,
): Promise<{ diff: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--no-color", "--", file], {
      cwd: workdir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;

      const remaining = REALTIME_DIFF_MAX_BYTES - totalBytes;
      if (remaining <= 0) {
        truncated = true;
        child.kill();
        return;
      }

      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        totalBytes += remaining;
        truncated = true;
        child.kill();
        return;
      }

      chunks.push(chunk);
      totalBytes += chunk.length;
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (!truncated && code !== 0) {
        reject(new Error(`git diff failed: ${code ?? signal ?? "unknown"}`));
        return;
      }

      const diff = Buffer.concat(chunks).toString("utf8");
      resolve(truncateDiffPreview(diff, truncated));
    });
  });
}

function truncateDiffPreview(diff: string, alreadyTruncated: boolean): { diff: string; truncated: boolean } {
  const lines = diff.split("\n");
  if (lines.length <= REALTIME_DIFF_MAX_LINES) {
    return { diff, truncated: alreadyTruncated };
  }
  return {
    diff: lines.slice(0, REALTIME_DIFF_MAX_LINES).join("\n"),
    truncated: true,
  };
}

function normalizeDisplayPath(file: string, workdir: string): string {
  const resolved = path.resolve(workdir, file);
  const relative = path.relative(workdir, resolved);
  return relative && !relative.startsWith("..") ? relative : file;
}

function truncateOneLine(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) || "";
  } catch {
    return String(value);
  }
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
