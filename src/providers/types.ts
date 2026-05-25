import type { SandboxMode } from "../types.js";
import type { ClaudeAgentStreamEvent } from "./claude-code-agent-events.js";

export interface ProviderModel {
  id: string;
  name: string;
  description: string;
}

export interface RunOptions {
  workdir: string;
  prompt: string;
  model?: string;
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
      onEvent: (event: ClaudeAgentStreamEvent) => void | Promise<void>;
    },
  ): Promise<RunResult>;
}

export class ProviderCancelledError extends Error {
  constructor() {
    super("已中断");
    this.name = "ProviderCancelledError";
  }
}
