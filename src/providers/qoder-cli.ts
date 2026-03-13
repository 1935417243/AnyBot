import { spawn } from "node:child_process";
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

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1_000;

const TRANSIENT_ERROR_PATTERNS = [
  /TLS/i,
  /socket disconnected/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /EPIPE/,
  /Connection lost/i,
  /network socket/i,
  /fetch failed/i,
];

interface QoderContentItem {
  type?: string;
  text?: string;
}

interface QoderJsonOutput {
  type?: string;        // "result" | "error"
  subtype?: string;     // "success" | "error_during_execution"
  message?: {
    content?: QoderContentItem[];
    session_id?: string;
  };
  error?: Record<string, unknown>;
  error_code?: number;
  session_id?: string;
  done?: boolean;
}

export class QoderCliProvider implements IProvider {
  readonly type = "qoder-cli";
  readonly displayName = "Qoder CLI";
  readonly capabilities: ProviderCapabilities = {
    sessionResume: true,
    imageInput: false,
    sandbox: false,
  };

  private readonly bin: string;
  private readonly maxTurns: number;

  constructor(opts?: { bin?: string; maxTurns?: number }) {
    this.bin = opts?.bin ?? "qodercli";
    this.maxTurns = opts?.maxTurns ?? 0;
  }

  listModels(): ProviderModel[] {
    return [
      { id: "auto", name: "Auto", description: "自动选择最佳模型" },
      { id: "ultimate", name: "Ultimate", description: "旗舰模型，最强能力" },
      { id: "performance", name: "Performance", description: "高性能均衡模型" },
      { id: "efficient", name: "Efficient", description: "高效轻量模型" },
      { id: "lite", name: "Lite", description: "最快响应模型" },
    ];
  }

  async run(opts: RunOptions): Promise<RunResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      try {
        return await this.runOnce(opts, attempt);
      } catch (err) {
        lastError = err as Error;

        if (err instanceof ProviderTimeoutError) throw err;

        const isTransient = TRANSIENT_ERROR_PATTERNS.some((p) =>
          p.test(err instanceof Error ? err.message : String(err)),
        );

        if (attempt < MAX_TRANSIENT_RETRIES && isTransient) {
          const delay = RETRY_BASE_DELAY_MS * (attempt + 1);
          logger.warn("provider.exec.transient_retry", {
            provider: this.type,
            attempt: attempt + 1,
            maxRetries: MAX_TRANSIENT_RETRIES,
            delayMs: delay,
            error: lastError.message,
          });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw err;
      }
    }

    throw lastError!;
  }

  private async runOnce(opts: RunOptions, attempt: number): Promise<RunResult> {
    const {
      workdir,
      prompt,
      model,
      sessionId,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;
    const startedAt = Date.now();

    const args = this.buildArgs({ prompt, model, sessionId, workdir });

    logger.info("provider.exec.start", {
      provider: this.type,
      bin: this.bin,
      workdir,
      model: model || null,
      sessionId: sessionId || null,
      promptChars: prompt.length,
      timeoutMs,
      attempt,
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
          attempt,
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
            attempt,
          });
          reject(new ProviderProcessError(code, stderr || stdout));
          return;
        }

        const parsed = this.extractJson(stdout);
        if (!parsed) {
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

        if (parsed.type === "error") {
          const errMsg = `Qoder error (code ${parsed.error_code ?? "unknown"}): ${parsed.subtype || "unknown"}`;
          logger.error("provider.exec.api_error", {
            provider: this.type,
            workdir,
            durationMs: Date.now() - startedAt,
            subtype: parsed.subtype,
            errorCode: parsed.error_code,
          });
          reject(new ProviderProcessError(1, errMsg));
          return;
        }

        const responseText = this.extractText(parsed);
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

        const returnedSessionId = parsed.session_id || sessionId || null;

        logger.info("provider.exec.success", {
          provider: this.type,
          workdir,
          durationMs: Date.now() - startedAt,
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
          replyChars: responseText.length,
          sessionId: returnedSessionId,
          attempt,
        });

        resolve({
          text: responseText,
          sessionId: returnedSessionId,
        });
      });
    });
  }

  private buildArgs(opts: {
    prompt: string;
    model?: string;
    sessionId?: string;
    workdir: string;
  }): string[] {
    const args: string[] = [
      "-q",
      "-p", opts.prompt,
      "-f", "json",
      "--dangerously-skip-permissions",
      "-w", opts.workdir,
    ];

    if (opts.model && opts.model !== "auto") {
      args.push("--model", opts.model);
    }

    if (opts.sessionId) {
      args.push("-r", opts.sessionId);
    }

    if (this.maxTurns > 0) {
      args.push("--max-turns", String(this.maxTurns));
    }

    return args;
  }

  /**
   * stdout 可能混入非 JSON 行，找到最后一个有效 JSON 进行解析。
   */
  private extractJson(stdout: string): QoderJsonOutput | null {
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || !line.startsWith("{")) continue;
      try {
        return JSON.parse(line) as QoderJsonOutput;
      } catch {
        continue;
      }
    }
    return null;
  }

  private extractText(parsed: QoderJsonOutput): string | null {
    const items = parsed.message?.content;
    if (!Array.isArray(items) || items.length === 0) return null;

    const texts = items
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text!.trim())
      .filter(Boolean);

    return texts.join("\n\n") || null;
  }
}
