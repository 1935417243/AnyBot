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

/** CodeBuddy 支持的强度档位（CLI 实测仅接受这 4 档；默认 medium） */
export const CODEBUDDY_EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh"];

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
  /** Agent 调用提问工具时由调用方展示问题并等待用户回复；未提供时 Provider 不接管提问，沿用原有权限策略 */
  askUserQuestion?: (
    request: ProviderUserQuestionRequest,
    signal: AbortSignal,
  ) => Promise<ProviderUserQuestionReply>;
  /** AnyBot 内置 MCP Server 的本次运行连接信息；由 ChatRunner 按运行签发，未提供时不注入内置工具 */
  appMcpServer?: AppMcpServerConnection;
}

/** AnyBot 内置 MCP Server（自动化管理等工具）的单次运行连接信息，Provider 只负责按自身格式注入 */
export interface AppMcpServerConnection {
  /** 内置 MCP Server 的 Streamable HTTP 地址 */
  url: string;
  /** 访问内置 MCP Server 需携带的请求头（API token 与本次运行凭证） */
  headers: Record<string, string>;
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

/** Agent 提问中的单个选项 */
export interface ProviderUserQuestionOption {
  /** 选项文本，用户选中后作为答案回传 */
  label: string;
  /** 选项说明 */
  description: string;
}

/** Agent 提问中的单个问题 */
export interface ProviderUserQuestionItem {
  /** 问题全文，同时作为回答映射的键 */
  question: string;
  /** 问题的简短标签 */
  header: string;
  /** 预设选项，用户也可以填写自定义答案 */
  options: ProviderUserQuestionOption[];
  /** 是否允许多选 */
  multiSelect: boolean;
}

/** Agent 的一次提问，可包含多个问题 */
export interface ProviderUserQuestionRequest {
  /** 提问 ID，取自提问工具的调用 ID */
  id: string;
  /** 本次提出的问题 */
  questions: ProviderUserQuestionItem[];
}

/** 用户对提问的回复：answer 携带「问题全文 → 答案」映射，skip 表示跳过全部问题 */
export type ProviderUserQuestionReply =
  | { action: "answer"; answers: Record<string, string> }
  | { action: "skip" };
