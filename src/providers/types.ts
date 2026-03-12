import type { SandboxMode } from "../types.js";

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
  sandbox?: SandboxMode;
  timeoutMs?: number;
}

export interface RunResult {
  text: string;
  sessionId: string | null;
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
  [key: string]: unknown;
}

export interface IProvider {
  readonly type: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  listModels(): ProviderModel[];
  run(opts: RunOptions): Promise<RunResult>;
}
