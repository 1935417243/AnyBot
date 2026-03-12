import { spawn, execSync } from "node:child_process";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
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
const MODELS_CACHE_TTL_MS = 30 * 60 * 1000;

interface CursorJsonOutput {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  result?: string;
  session_id?: string;
  request_id?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/**
 * The `agent` CLI is a bash wrapper that invokes a bundled Node.js binary
 * (`$SCRIPT_DIR/node`) with `$SCRIPT_DIR/index.js`. When spawned as a
 * detached child process, the wrapper's symlink/realpath resolution can fail,
 * causing TLS connection errors. We resolve the real paths at construction
 * time and spawn the node binary directly.
 */
function resolveAgentPaths(bin: string): { nodeBin: string; indexJs: string } | null {
  try {
    const whichOutput = execSync(`which ${bin}`, {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!whichOutput) return null;

    const scriptContent = readFileSync(whichOutput, "utf8");
    if (!scriptContent.startsWith("#!/")) return null;

    const realTarget = realpathSync(whichOutput);
    const scriptDir = path.dirname(realTarget);

    const nodeBin = path.join(scriptDir, "node");
    const indexJs = path.join(scriptDir, "index.js");
    if (!existsSync(nodeBin) || !existsSync(indexJs)) return null;

    return { nodeBin, indexJs };
  } catch {
    return null;
  }
}

export class CursorCliProvider implements IProvider {
  readonly type = "cursor-cli";
  readonly displayName = "Cursor CLI";
  readonly capabilities: ProviderCapabilities = {
    sessionResume: true,
    imageInput: false,
    sandbox: true,
  };

  private readonly bin: string;
  private readonly workspace: string | undefined;
  private readonly apiKey: string | undefined;

  private readonly resolvedNodeBin: string | null;
  private readonly resolvedIndexJs: string | null;

  private modelsCache: ProviderModel[] | null = null;
  private modelsCacheExpiry = 0;

  constructor(opts?: { bin?: string; workspace?: string; apiKey?: string }) {
    this.bin = opts?.bin ?? "agent";
    this.workspace = opts?.workspace;
    this.apiKey = opts?.apiKey;

    const resolved = resolveAgentPaths(this.bin);
    this.resolvedNodeBin = resolved?.nodeBin ?? null;
    this.resolvedIndexJs = resolved?.indexJs ?? null;

    if (resolved) {
      logger.info("provider.cursor_cli.resolved_paths", {
        nodeBin: resolved.nodeBin,
        indexJs: resolved.indexJs,
      });
    }
  }

  listModels(): ProviderModel[] {
    if (this.modelsCache && Date.now() < this.modelsCacheExpiry) {
      return this.modelsCache;
    }

    try {
      const output = execSync(`${this.bin} --list-models`, {
        timeout: 15_000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.modelsCache = this.parseModelList(output);
      this.modelsCacheExpiry = Date.now() + MODELS_CACHE_TTL_MS;
      return this.modelsCache;
    } catch (err) {
      logger.warn("provider.models.fetch_failed", {
        provider: this.type,
        error: String(err),
      });
      return [{ id: "auto", name: "Auto", description: "自动选择最佳模型" }];
    }
  }

  async run(opts: RunOptions): Promise<RunResult> {
    const {
      workdir,
      prompt,
      model,
      sessionId,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;
    const sandbox = opts.sandbox ?? "read-only";
    const startedAt = Date.now();

    const args = this.buildArgs({
      prompt,
      model,
      sessionId,
      sandbox,
      workdir,
    });

    logger.info("provider.exec.start", {
      provider: this.type,
      bin: this.bin,
      workdir,
      sandbox,
      model: model || null,
      sessionId: sessionId || null,
      promptChars: prompt.length,
      timeoutMs,
    });

    return new Promise((resolve, reject) => {
      const [spawnBin, spawnArgs] = this.resolvedNodeBin && this.resolvedIndexJs
        ? [this.resolvedNodeBin, ["--use-system-ca", this.resolvedIndexJs, ...args]]
        : [this.bin, args];

      const child = spawn(spawnBin, spawnArgs, {
        cwd: workdir,
        env: this.buildEnv(),
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
          sandbox,
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
            sandbox,
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
            sandbox,
            durationMs: Date.now() - startedAt,
            stdoutChars: stdout.length,
            stderrChars: stderr.length,
            stderrPreview: stderr.slice(0, 400),
            stdoutPreview: stdout.slice(0, 400),
          });
          reject(new ProviderProcessError(code, stderr || stdout));
          return;
        }

        const parsed = this.extractJson(stdout);
        if (!parsed) {
          logger.error("provider.exec.parse_error", {
            provider: this.type,
            workdir,
            sandbox,
            durationMs: Date.now() - startedAt,
            stdoutChars: stdout.length,
            stdoutPreview: stdout.slice(0, 400),
          });
          reject(new ProviderParseError(stdout));
          return;
        }

        if (parsed.is_error) {
          const errMsg = parsed.result || "unknown error";
          logger.error("provider.exec.api_error", {
            provider: this.type,
            workdir,
            sandbox,
            durationMs: Date.now() - startedAt,
            subtype: parsed.subtype,
            errorMessage: errMsg,
          });
          reject(new ProviderProcessError(1, errMsg));
          return;
        }

        const responseText = parsed.result?.trim();
        if (!responseText) {
          logger.error("provider.exec.empty_response", {
            provider: this.type,
            workdir,
            sandbox,
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
          sandbox,
          durationMs: Date.now() - startedAt,
          durationApiMs: parsed.duration_api_ms,
          stdoutChars: stdout.length,
          stderrChars: stderr.length,
          replyChars: responseText.length,
          sessionId: returnedSessionId,
          inputTokens: parsed.usage?.inputTokens,
          outputTokens: parsed.usage?.outputTokens,
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
    sandbox: string;
    workdir: string;
  }): string[] {
    const args: string[] = [
      "-p", opts.prompt,
      "--output-format", "json",
      "--force",
      "--trust",
      "--approve-mcps",
    ];

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.sessionId) {
      args.push("--resume", opts.sessionId);
    }

    const workspace = this.workspace || opts.workdir;
    args.push("--workspace", workspace);

    if (opts.sandbox === "danger-full-access" || opts.sandbox === "workspace-write") {
      args.push("--sandbox", "disabled");
    } else {
      args.push("--sandbox", "enabled");
    }

    return args;
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (this.apiKey) {
      env.CURSOR_API_KEY = this.apiKey;
    }
    if (this.resolvedNodeBin) {
      env.CURSOR_INVOKED_AS = path.basename(this.bin);
      env.NODE_COMPILE_CACHE ??=
        process.platform === "darwin"
          ? `${process.env.HOME}/Library/Caches/cursor-compile-cache`
          : `${process.env.XDG_CACHE_HOME || process.env.HOME + "/.cache"}/cursor-compile-cache`;
    }
    return env;
  }

  /**
   * stdout 可能混入重试日志（Connection lost...），
   * 找到最后一个有效的 JSON 行进行解析。
   */
  private extractJson(stdout: string): CursorJsonOutput | null {
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || !line.startsWith("{")) continue;
      try {
        return JSON.parse(line) as CursorJsonOutput;
      } catch {
        continue;
      }
    }
    return null;
  }

  private parseModelList(output: string): ProviderModel[] {
    const models: ProviderModel[] = [];
    const lines = output.trim().split("\n");

    for (const line of lines) {
      const match = line.match(/^\s*(\S+)\s+-\s+(.+?)\s*$/);
      if (!match) continue;

      const [, id, rawName] = match;
      if (id.toLowerCase() === "available" || id.toLowerCase() === "tip:") continue;

      const isCurrent = /\(current\)/i.test(rawName);
      const isDefault = /\(default\)/i.test(rawName);
      const name = rawName
        .replace(/\s*\(current\)/gi, "")
        .replace(/\s*\(default\)/gi, "")
        .trim();

      const tags: string[] = [];
      if (isCurrent) tags.push("current");
      if (isDefault) tags.push("default");

      models.push({
        id,
        name,
        description: tags.length > 0 ? tags.join(", ") : "",
      });
    }

    if (models.length === 0) {
      return [{ id: "auto", name: "Auto", description: "自动选择最佳模型" }];
    }

    return models;
  }
}
