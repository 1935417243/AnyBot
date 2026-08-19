import type { SandboxMode } from "../types.js";
import type { ClaudeAgentStreamEvent } from "./claude-code-agent-events.js";

export interface ProviderModel {
  id: string;
  name: string;
  description: string;
}

/** 推理强度档位；ultracode 是 UI 档位，传给 Claude Agent SDK 时会映射为 xhigh */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";

/** 全部可选强度档位，顺序即前端滑块从左到右（快速 → 深度）的顺序 */
export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max", "ultracode"];

/** Codex 支持的强度档位（与 Codex CLI 选择器一致，共 4 档） */
export const CODEX_EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh"];

export interface RunOptions {
  workdir: string;
  prompt: string;
  model?: string;
  /** 推理强度档位，仅支持的 provider（claude-code、codex）会生效，其余 provider 忽略 */
  effort?: EffortLevel;
  imagePaths?: string[];
  sessionId?: string;
  /** Optional UUID used by providers that can explicitly create a fresh session. */
  newSessionId?: string;
  /** Send the prompt directly to the provider without AnyBot prompt prelude. */
  rawProviderCommand?: boolean;
  sandbox?: SandboxMode;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  text: string;
  sessionId: string | null;
  contextUsage?: ProviderContextUsage;
}

export interface ProviderContextUsage {
  usedTokens: number;
  maxTokens: number;
  usedPercentage: number;
  remainingPercentage: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  source: "claude-code" | "codex" | string;
}

export type CodexAnswerDoneEvent = {
  type: "codex_answer_done";
  content: string;
  title?: string;
  sessionId: string | null;
  provider: "codex";
  durationMs?: number;
  contextUsage?: ProviderContextUsage;
};

export type ProviderStreamEvent = ClaudeAgentStreamEvent | CodexAnswerDoneEvent;

export interface ProviderSlashCommand {
  id: string;
  name: string;
  description: string;
  command?: string;
}

export interface ProviderCapabilities {
  sessionResume: boolean;
  imageInput: boolean;
  sandbox: boolean;
}

export interface ProviderConfig {
  type: string;
  bin?: string;
  defaultModel?: string;
  timeoutMs?: number;
  [key: string]: unknown;
}

export interface IProvider {
  readonly type: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  listModels(): ProviderModel[];
  listSlashCommands?(): ProviderSlashCommand[];
  run(opts: RunOptions): Promise<RunResult>;
  runWithEvents?(
    opts: RunOptions & {
      onEvent: (event: ProviderStreamEvent) => void | Promise<void>;
    },
  ): Promise<RunResult>;
}

export class ProviderCancelledError extends Error {
  constructor() {
    super("已中断");
    this.name = "ProviderCancelledError";
  }
}
