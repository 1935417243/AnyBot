import {spawn} from "node:child_process";
import type {IProvider, ProviderCapabilities, ProviderModel, RunOptions, RunResult,} from "./types.js";
import type {CodexJsonEvent} from "../types.js";
import {logger} from "../logger.js";

export class ProviderTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Provider 执行超时（${Math.round(timeoutMs / 1000)}s）`);
        this.name = "ProviderTimeoutError";
    }
}

export class ProviderProcessError extends Error {
    constructor(exitCode: number | null, output: string) {
        const code = exitCode ?? "unknown";
        const preview = output.slice(0, 300);
        super(`Provider 进程异常退出（状态码 ${code}）：${preview}`);
        this.name = "ProviderProcessError";
    }
}

export class ProviderEmptyOutputError extends Error {
    constructor() {
        super("Provider 返回了空内容");
        this.name = "ProviderEmptyOutputError";
    }
}

export class ProviderParseError extends Error {
    constructor(stdout: string) {
        const preview = stdout.slice(0, 300);
        super(`无法从 Provider 输出中解析有效消息：${preview}`);
        this.name = "ProviderParseError";
    }
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class CodexProvider implements IProvider {
    readonly type = "codex";
    readonly displayName = "Codex CLI";
    readonly capabilities: ProviderCapabilities = {
        sessionResume: true,
        imageInput: true,
        sandbox: true,
    };

    private readonly bin: string;

    constructor(opts?: { bin?: string }) {
        this.bin = opts?.bin ?? "codex";
    }

    listModels(): ProviderModel[] {
        return [
            {id: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "默认编程模型"},
            {id: "gpt-5.4", name: "GPT-5.4", description: "最新通用模型"},
            {id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "轻量快速模型"},
            {id: "gpt-5.2-codex", name: "GPT-5.2 Codex", description: "稳定编程模型"},
        ];
    }

    async run(opts: RunOptions): Promise<RunResult> {
        const {
            workdir,
            prompt,
            model,
            imagePaths = [],
            sessionId,
            timeoutMs = DEFAULT_TIMEOUT_MS,
        } = opts;
        const sandbox = opts.sandbox ?? process.env.CODEX_SANDBOX ?? "read-only";
        const startedAt = Date.now();

        const args: string[] = sessionId
            ? ["exec", "resume", "--json", "--skip-git-repo-check"]
            : ["exec", "--json", "--skip-git-repo-check", "-C", workdir, "-s", sandbox];

        // resume 模式不支持 -s，需要用其他方式传递沙箱权限
        if (sessionId) {
            if (sandbox === "danger-full-access") {
                args.push("--dangerously-bypass-approvals-and-sandbox");
            } else if (sandbox === "workspace-write") {
                // --full-auto 等价于 --sandbox workspace-write
                args.push("--full-auto");
            }
        }

        if (model) {
            args.push("-m", model);
        }

        for (const imagePath of imagePaths) {
            args.push("-i", imagePath);
        }

        if (sessionId) {
            args.push(sessionId);
        }
        args.push("-");

        logger.info("provider.exec.start", {
            provider: this.type,
            bin: this.bin,
            workdir,
            sandbox,
            model: model || null,
            sessionId: sessionId || null,
            imageCount: imagePaths.length,
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
            let startedThreadId: string | null = null;

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

            child.stdin.write(prompt);
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

                const lines = stdout
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);

                const messages = lines
                    .map((line) => {
                        try {
                            const event = JSON.parse(line) as CodexJsonEvent;
                            if (event.type === "thread.started" && event.thread_id) {
                                startedThreadId = event.thread_id;
                            }
                            return event;
                        } catch {
                            return null;
                        }
                    })
                    .filter((event): event is CodexJsonEvent => Boolean(event))
                    .filter(
                        (event) =>
                            event.type === "item.completed" &&
                            event.item?.type === "agent_message" &&
                            Boolean(event.item.text),
                    )
                    .map((event) => event.item?.text?.trim() || "")
                    .filter(Boolean);

                const lastMessage = messages.at(-1);
                if (!lastMessage) {
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

                logger.info("provider.exec.success", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                    stdoutChars: stdout.length,
                    stderrChars: stderr.length,
                    messageCount: messages.length,
                    replyChars: lastMessage.length,
                    sessionId: startedThreadId || sessionId || null,
                });
                resolve({
                    text: lastMessage,
                    sessionId: startedThreadId || sessionId || null,
                });
            });
        });
    }
}
