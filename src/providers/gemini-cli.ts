import { spawn, execSync } from "node:child_process";
import type {
  IProvider,
  RunOptions,
  RunResult,
  ProviderModel,
  ProviderCapabilities,
} from "./types.js";
import {
  ProviderTimeoutError,
  ProviderProcessError,
  ProviderEmptyOutputError,
  ProviderParseError,
} from "./codex.js";
import { logger } from "../logger.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

interface GeminiJsonOutput {
  response?: string;
  stats?: unknown;
  error?: {
    type?: string;
    message?: string;
    code?: number;
  };
}

export class GeminiCliProvider implements IProvider {
  readonly type = "gemini-cli";
  readonly displayName = "Gemini CLI";
  readonly capabilities: ProviderCapabilities = {
    sessionResume: true,
    imageInput: false,
    sandbox: false,
  };

  private readonly bin: string;
  private readonly approvalMode: string;

  constructor(opts?: { bin?: string; approvalMode?: string }) {
    this.bin = opts?.bin ?? "gemini";
    this.approvalMode = opts?.approvalMode ?? "yolo";
  }

  listModels(): ProviderModel[] {
    return [
      { id: "auto", name: "Auto", description: "自动选择最佳模型" },
      { id: "pro", name: "Gemini Pro", description: "复杂推理任务" },
      { id: "flash", name: "Gemini Flash", description: "快速均衡模型" },
      { id: "flash-lite", name: "Gemini Flash Lite", description: "最快轻量模型" },
    ];
  }

  async run(opts: RunOptions): Promise<RunResult> {
    const {
      workdir,
      prompt,
      model,
      sessionId,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;
    const startedAt = Date.now();

    const args: string[] = [
      "-p", prompt,
      "--output-format", "json",
      "--approval-mode", this.approvalMode,
    ];

    if (model) {
      args.push("-m", model);
    }

    if (sessionId) {
      args.push("-r", sessionId);
    }

    logger.info("provider.exec.start", {
      provider: this.type,
      bin: this.bin,
      workdir,
      model: model || null,
      sessionId: sessionId || null,
      promptChars: prompt.length,
      timeoutMs,
    });

    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        cwd: workdir,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const killProcessGroup = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };

      const timer = setTimeout(() => {
        killed = true;
        killProcessGroup("SIGTERM");
        setTimeout(() => {
          if (!child.killed) killProcessGroup("SIGKILL");
        }, 3000);
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.stdin.end();

      child.on("error", (error) => {
        clearTimeout(timer);
        logger.error("provider.exec.spawn_error", {
          provider: this.type,
          workdir,
          durationMs: Date.now() - startedAt,
          error,
        });
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (killed) {
          logger.warn("provider.exec.timeout", {
            provider: this.type,
            workdir,
            durationMs: Date.now() - startedAt,
            stdoutChars: stdout.length,
            stderrChars: stderr.length,
          });
          reject(new ProviderTimeoutError(timeoutMs));
          return;
        }

        if (code !== 0) {
          logger.error("provider.exec.non_zero_exit", {
            provider: this.type,
            code,
            workdir,
            durationMs: Date.now() - startedAt,
            stdoutChars: stdout.length,
            stderrChars: stderr.length,
            stderrPreview: stderr.slice(0, 400),
            stdoutPreview: stdout.slice(0, 400),
          });
          reject(new ProviderProcessError(code, stderr || stdout));
          return;
        }

        let parsed: GeminiJsonOutput;
        try {
          parsed = JSON.parse(stdout.trim()) as GeminiJsonOutput;
        } catch {
          logger.error("provider.exec.parse_error", {
            provider: this.type,
            workdir,
            durationMs: Date.now() - startedAt,
            stdoutChars: stdout.length,
            stdoutPreview: stdout.slice(0, 400),
          });
          reject(new ProviderParseError(stdout));
          return;
        }

        if (parsed.error) {
          const errMsg = `${parsed.error.type || "Error"}: ${parsed.error.message || "unknown"}`;
          logger.error("provider.exec.api_error", {
            provider: this.type,
            workdir,
            durationMs: Date.now() - startedAt,
            errorType: parsed.error.type,
            errorMessage: parsed.error.message,
            errorCode: parsed.error.code,
          });
          reject(new ProviderProcessError(parsed.error.code ?? 1, errMsg));
          return;
        }

        const responseText = parsed.response?.trim();
        if (!responseText) {
          logger.error("provider.exec.empty_response", {
            provider: this.type,
            workdir,
            durationMs: Date.now() - startedAt,
            stdoutChars: stdout.length,
          });
          reject(new ProviderEmptyOutputError());
          return;
        }

        const newSessionId = sessionId ?? this.resolveLatestSessionId(workdir);

        logger.info("provider.exec.success", {
          provider: this.type,
          workdir,
          durationMs: Date.now() - startedAt,
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
          replyChars: responseText.length,
          sessionId: newSessionId,
        });

        resolve({
          text: responseText,
          sessionId: newSessionId,
        });
      });
    });
  }

  private resolveLatestSessionId(workdir: string): string | null {
    try {
      const output = execSync(`${this.bin} --list-sessions`, {
        cwd: workdir,
        timeout: 10_000,
        encoding: "utf8",
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const lines = output.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^\s*1[.):\s]+.*?([0-9a-f]{8,}(?:-[0-9a-f]+)*)/i);
        if (match) return match[1];
      }

      const uuidMatch = lines[0]?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (uuidMatch) return uuidMatch[1];

      return null;
    } catch {
      logger.warn("provider.session.list_failed", { provider: this.type });
      return null;
    }
  }
}
