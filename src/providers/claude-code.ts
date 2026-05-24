import {mkdirSync} from "node:fs";
import path from "node:path";
import {
    type Options,
    type PermissionMode,
    query,
    type SDKAssistantMessage,
    type SDKCompactBoundaryMessage,
    type SDKMessage,
    type SDKResultMessage,
    type SDKStatusMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    IProvider,
    ProviderCapabilities,
    ProviderContextUsage,
    ProviderModel,
    ProviderSlashCommand,
    RunOptions,
    RunResult,
} from "./types.js";
import {ProviderCancelledError} from "./types.js";
import {ProviderEmptyOutputError, ProviderProcessError, ProviderTimeoutError,} from "./codex.js";
import {
    type ClaudeAgentStreamEvent,
    createFileChangeEvent,
    createTaskEvent,
    createToolEndEvent,
    createToolProgressEvent,
    createToolStartEvent,
    extractAssistantTextDelta,
    extractAssistantThinkingDelta,
} from "./claude-code-agent-events.js";
import {getDataDir} from "../app-settings.js";
import {logger} from "../logger.js";
import {DEFAULT_SANDBOX} from "../sandbox-config.js";
import type {SandboxMode} from "../types.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const WORKDIR_SAFETY_PROMPT = [
    "## 工作目录规则",
    "- 在进行任何文件操作之前，先使用 `pwd` 确认当前处于正确目录",
    "- 未经用户明确确认，绝不要使用 `git reset --hard` 或 `git clean -fd`",
    "- 对关键操作使用绝对路径",
    "## 执行效率规则",
    "- 需要探索多个独立文件、目录或模块时，优先并行使用只读搜索/读取工具或 Agent/Task 子任务",
    "- 子任务只负责独立探索和分析，最终结论由主任务整合",
].join("\n");

const DISCOVERY_TOOLS = [
    "Read",
    "Grep",
    "Glob",
    "LS",
    "LSP",
    "ToolSearch",
    "TodoWrite",
    "Task",
    "Agent",
    "TaskCreate",
    "TaskGet",
    "TaskUpdate",
    "TaskList",
    "TaskStop",
    "TaskOutput",
    "SendMessage",
    "Sleep",
    "WebSearch",
    "WebFetch",
];
const READ_ONLY_TOOLS = DISCOVERY_TOOLS;
const WORKSPACE_WRITE_TOOLS = [
    ...DISCOVERY_TOOLS,
    "Bash",
    "Edit",
    "MultiEdit",
    "Write",
    "NotebookEdit",
];

function isSdkResultMessage(message: SDKMessage): message is SDKResultMessage {
    return message.type === "result";
}

function isSdkAssistantMessage(message: SDKMessage): message is SDKAssistantMessage {
    return message.type === "assistant";
}

function isSdkCompactBoundaryMessage(message: SDKMessage): message is SDKCompactBoundaryMessage {
    return message.type === "system" && "subtype" in message && message.subtype === "compact_boundary";
}

function isSdkStatusMessage(message: SDKMessage): message is SDKStatusMessage {
    return message.type === "system" && "subtype" in message && message.subtype === "status";
}

function mapSandboxToPermissionMode(sandbox: SandboxMode): PermissionMode {
    switch (sandbox) {
        case "danger-full-access":
            return "bypassPermissions";
        case "workspace-write":
            return "acceptEdits";
        case "read-only":
        default:
            return "dontAsk";
    }
}

function buildSandboxOptions(sandbox: SandboxMode, workdir: string): Options["sandbox"] {
    if (sandbox === "danger-full-access") {
        return {enabled: false};
    }

    return {
        enabled: true,
        failIfUnavailable: false,
        autoAllowBashIfSandboxed: sandbox === "workspace-write",
        filesystem: {
            allowRead: [workdir],
            allowWrite: sandbox === "workspace-write" ? [workdir] : [],
        },
    };
}

function buildAllowedTools(sandbox: SandboxMode): string[] | undefined {
    if (sandbox === "danger-full-access") {
        return undefined;
    }

    return sandbox === "workspace-write" ? WORKSPACE_WRITE_TOOLS : READ_ONLY_TOOLS;
}

function getUsageNumber(usage: unknown, key: string): number {
    if (!usage || typeof usage !== "object") return 0;
    const value = (usage as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function calculateClaudeAssistantUsageTokens(usage: unknown): number {
    return (
        getUsageNumber(usage, "input_tokens") +
        getUsageNumber(usage, "cache_creation_input_tokens") +
        getUsageNumber(usage, "cache_read_input_tokens") +
        getUsageNumber(usage, "output_tokens")
    );
}

function buildContextUsage(
    usedTokens: number,
    maxTokens: number | undefined,
    tokenBreakdown?: Partial<Pick<
        ProviderContextUsage,
        "inputTokens" | "outputTokens" | "cacheCreationInputTokens" | "cacheReadInputTokens"
    >>,
): ProviderContextUsage | undefined {
    if (!Number.isFinite(usedTokens) || usedTokens <= 0) return undefined;
    if (!maxTokens || !Number.isFinite(maxTokens) || maxTokens <= 0) return undefined;

    const usedPercentage = Math.min(100, Math.round((usedTokens / maxTokens) * 1000) / 10);
    return {
        usedTokens,
        maxTokens,
        usedPercentage,
        remainingPercentage: Math.max(0, Math.round((100 - usedPercentage) * 10) / 10),
        ...tokenBreakdown,
        source: "claude-code",
    };
}

function extractContextWindowFromResult(result: SDKResultMessage): number | undefined {
    const modelUsages = Object.values(result.modelUsage || {});
    return modelUsages.find((entry) => entry.contextWindow > 0)?.contextWindow;
}

function extractContextUsageFromCompactBoundary(
    message: SDKCompactBoundaryMessage | null,
    maxTokens: number | undefined,
): ProviderContextUsage | undefined {
    const postTokens = message?.compact_metadata.post_tokens;
    if (typeof postTokens !== "number" || !Number.isFinite(postTokens)) return undefined;
    return buildContextUsage(postTokens, maxTokens);
}

function extractContextUsageFromResult(result: SDKResultMessage): ProviderContextUsage | undefined {
    const usageEntries = Object.values(result.modelUsage || {});
    const usage = usageEntries.find((entry) => entry.contextWindow > 0);
    if (!usage) return undefined;

    const inputTokens = usage.inputTokens || 0;
    const outputTokens = usage.outputTokens || 0;
    const cacheCreationInputTokens = usage.cacheCreationInputTokens || 0;
    const cacheReadInputTokens = usage.cacheReadInputTokens || 0;
    const usedTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;
    const maxTokens = usage.contextWindow || 0;
    return buildContextUsage(usedTokens, maxTokens, {
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
    });
}

function extractContextUsageFromAssistant(
    message: SDKAssistantMessage | null,
    maxTokens: number | undefined,
): ProviderContextUsage | undefined {
    const usage = message?.message?.usage;
    if (!usage || !maxTokens) return undefined;

    const inputTokens = getUsageNumber(usage, "input_tokens");
    const outputTokens = getUsageNumber(usage, "output_tokens");
    const cacheCreationInputTokens = getUsageNumber(usage, "cache_creation_input_tokens");
    const cacheReadInputTokens = getUsageNumber(usage, "cache_read_input_tokens");
    const usedTokens = calculateClaudeAssistantUsageTokens(usage);
    return buildContextUsage(usedTokens, maxTokens, {
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
    });
}

function mergeStreamedAndFinalResponse(streamed: string, finalResult: string): string {
    const streamedText = streamed.trim();
    const finalText = finalResult.trim();
    if (!streamedText) return finalText;
    if (!finalText) return streamedText;
    if (streamedText === finalText) return finalText;
    if (streamedText.endsWith(finalText)) return streamedText;
    if (finalText.endsWith(streamedText) || finalText.includes(streamedText)) return finalText;
    if (streamedText.includes(finalText)) return streamedText;
    return `${streamedText}\n\n${finalText}`;
}

export class ClaudeCodeProvider implements IProvider {
    readonly type = "claude-code";
    readonly displayName = "Claude Code";
    readonly capabilities: ProviderCapabilities = {
        sessionResume: true,
        imageInput: false,
        sandbox: true,
    };

    private readonly pathToClaudeCodeExecutable: string | undefined;
    private readonly maxTurns: number | undefined;
    private readonly permissionMode: PermissionMode | undefined;
    private readonly defaultModel: string | undefined;
    private readonly apiKey: string | undefined;
    private readonly apiKeyHelper: string | undefined;
    private readonly anthropicBaseUrl: string | undefined;
    private readonly anthropicAutoModel: string | undefined;
    private readonly anthropicOpusModel: string | undefined;
    private readonly anthropicSonnetModel: string | undefined;
    private readonly anthropicHaikuModel: string | undefined;
    private readonly claudeCodeSubagentModel: string | undefined;

    constructor(opts?: {
        pathToClaudeCodeExecutable?: string;
        maxTurns?: number;
        permissionMode?: PermissionMode;
        defaultModel?: string;
        apiKey?: string;
        apiKeyHelper?: string;
        anthropicBaseUrl?: string;
        anthropicAutoModel?: string;
        anthropicOpusModel?: string;
        anthropicSonnetModel?: string;
        anthropicHaikuModel?: string;
        claudeCodeSubagentModel?: string;
    }) {
        this.pathToClaudeCodeExecutable = opts?.pathToClaudeCodeExecutable;
        this.maxTurns = opts?.maxTurns;
        this.permissionMode = opts?.permissionMode;
        this.defaultModel = opts?.defaultModel;
        this.apiKey = opts?.apiKey;
        this.apiKeyHelper = opts?.apiKeyHelper;
        this.anthropicBaseUrl = opts?.anthropicBaseUrl;
        this.anthropicAutoModel = opts?.anthropicAutoModel;
        this.anthropicOpusModel = opts?.anthropicOpusModel;
        this.anthropicSonnetModel = opts?.anthropicSonnetModel;
        this.anthropicHaikuModel = opts?.anthropicHaikuModel;
        this.claudeCodeSubagentModel = opts?.claudeCodeSubagentModel;
    }

    listModels(): ProviderModel[] {
        const describeMapping = (fallback: string, mapped?: string) =>
            mapped ? `映射到 ${mapped}` : fallback;

        return [
            {
                id: "auto",
                name: "Auto",
                description: describeMapping("使用 Claude Code 默认模型", this.anthropicAutoModel || this.defaultModel)
            },
            {
                id: "claude-sonnet-4-6",
                name: "Claude Sonnet 4.6",
                description: describeMapping("默认推荐，均衡能力与速度", this.anthropicSonnetModel)
            },
            {
                id: "claude-opus-4-7",
                name: "Claude Opus 4.7",
                description: describeMapping("最强复杂任务模型", this.anthropicOpusModel)
            },
        ];
    }

    listSlashCommands(): ProviderSlashCommand[] {
        return [
            {
                id: "init",
                name: "初始化",
                command: "/init",
                description: "生成项目 CLAUDE.md 指南",
            },
            {
                id: "compact",
                name: "压缩",
                command: "/compact",
                description: "压缩此对话的上下文",
            },
        ];
    }

    async run(opts: RunOptions): Promise<RunResult> {
        return this.execute(opts);
    }

    async runWithEvents(
        opts: RunOptions & {
            onEvent: (event: ClaudeAgentStreamEvent) => void | Promise<void>;
        },
    ): Promise<RunResult> {
        return this.execute(opts, opts.onEvent);
    }

    private async execute(
        opts: RunOptions,
        onEvent?: (event: ClaudeAgentStreamEvent) => void | Promise<void>,
    ): Promise<RunResult> {
        const {
            workdir,
            model,
            sessionId,
            newSessionId,
            timeoutMs = DEFAULT_TIMEOUT_MS,
            signal,
        } = opts;
        const prompt = opts.rawProviderCommand
            ? opts.prompt
            : `${WORKDIR_SAFETY_PROMPT}\n\n${opts.prompt}`;
        const sandbox = opts.sandbox ?? DEFAULT_SANDBOX;
        const startedAt = Date.now();
        const abortController = new AbortController();
        const permissionMode = this.permissionMode ?? mapSandboxToPermissionMode(sandbox);
        const useAnthropicCompat = this.hasAnthropicCompatConfig();
        const claudeConfigDir = useAnthropicCompat ? this.getIsolatedClaudeConfigDir() : undefined;
        const resultModel = this.resolveModelAlias(model && model !== "auto" ? model : undefined)
            || this.anthropicAutoModel
            || this.defaultModel;

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            abortController.abort();
        }, timeoutMs);
        const abortFromSignal = () => abortController.abort(signal?.reason);
        if (signal?.aborted) {
            abortFromSignal();
        } else {
            signal?.addEventListener("abort", abortFromSignal, {once: true});
        }

        logger.info("provider.exec.start", {
            provider: this.type,
            bin: this.pathToClaudeCodeExecutable || null,
            claudeConfigDir: claudeConfigDir || null,
            workdir,
            sandbox,
            model: resultModel || null,
            anthropicBaseUrl: this.anthropicBaseUrl || null,
            anthropicAutoModel: this.anthropicAutoModel || this.defaultModel || null,
            anthropicOpusModel: this.anthropicOpusModel || null,
            anthropicSonnetModel: this.anthropicSonnetModel || null,
            anthropicHaikuModel: this.anthropicHaikuModel || null,
            claudeCodeSubagentModel: this.claudeCodeSubagentModel || null,
            apiKeyConfigured: Boolean(this.apiKey),
            apiKeyHelperConfigured: Boolean(this.apiKeyHelper),
            sessionId: sessionId || null,
            newSessionId: sessionId ? null : newSessionId || null,
            promptChars: prompt.length,
            timeoutMs,
            permissionMode,
        });

        try {
            let resultMessage: SDKResultMessage | null = null;
            let lastAssistantMessage: SDKAssistantMessage | null = null;
            let compactBoundaryMessage: SDKCompactBoundaryMessage | null = null;
            let compactError: string | null = null;
            let streamedResponseText = "";
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || "anybot/0.1.0",
            };
            this.applyAnthropicEnv(env);
            if (useAnthropicCompat) {
                env.CLAUDE_CONFIG_DIR = claudeConfigDir;
                delete env.CLAUDE_CODE_BIN;
                if (!this.apiKeyHelper) delete env.CLAUDE_CODE_API_KEY_HELPER;
                if (this.apiKey) {
                    delete env.ANTHROPIC_AUTH_TOKEN;
                    delete env.CLAUDE_CODE_OAUTH_TOKEN;
                }
            }

            if (!env.ANTHROPIC_API_KEY) {
                delete env.ANTHROPIC_API_KEY;
            }

            const flagSettings: Options["settings"] | undefined = this.apiKeyHelper
                ? {apiKeyHelper: this.apiKeyHelper}
                : undefined;

            await onEvent?.({
                type: "agent_status",
                status: "started",
                message: "Claude Code Agent 已启动",
            });

            const hooks: Options["hooks"] | undefined = onEvent
                ? {
                    PreToolUse: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = createToolStartEvent(input, workdir);
                                    if (event) await onEvent(event);
                                    return {};
                                },
                            ],
                        },
                    ],
                    PostToolUse: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = await createToolEndEvent(input, workdir);
                                    if (event) await onEvent(event);
                                    return {};
                                },
                            ],
                        },
                    ],
                    PostToolUseFailure: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = await createToolEndEvent(input, workdir);
                                    if (event) await onEvent(event);
                                    return {};
                                },
                            ],
                        },
                    ],
                    FileChanged: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = await createFileChangeEvent(input, workdir);
                                    if (event) await onEvent(event);
                                    return {};
                                },
                            ],
                        },
                    ],
                }
                : undefined;

            const stream = query({
                prompt,
                options: {
                    abortController,
                    cwd: workdir,
                    model: resultModel,
                    resume: sessionId,
                    sessionId: sessionId ? undefined : newSessionId,
                    pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable,
                    maxTurns: this.maxTurns,
                    permissionMode,
                    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
                    allowedTools: buildAllowedTools(sandbox),
                    tools: {type: "preset", preset: "claude_code"},
                    sandbox: buildSandboxOptions(sandbox, workdir),
                    includePartialMessages: !!onEvent,
                    agentProgressSummaries: !!onEvent,
                    hooks,
                    env,
                    settings: flagSettings,
                },
            });

            for await (const message of stream) {
                if (isSdkAssistantMessage(message)) {
                    lastAssistantMessage = message;
                }
                if (isSdkCompactBoundaryMessage(message)) {
                    compactBoundaryMessage = message;
                }
                if (isSdkStatusMessage(message) && message.compact_result === "failed") {
                    compactError = message.compact_error || "Claude Code 上下文压缩失败";
                }

                if (onEvent) {
                    const delta = extractAssistantTextDelta(message);
                    if (delta) {
                        streamedResponseText += delta;
                        await onEvent({type: "answer_delta", text: delta});
                    }

                    const thinking = extractAssistantThinkingDelta(message);
                    if (thinking) {
                        await onEvent({type: "thinking_delta", text: thinking});
                    }

                    const progress = createToolProgressEvent(message);
                    if (progress) {
                        await onEvent(progress);
                    }

                    const task = createTaskEvent(message);
                    if (task) {
                        await onEvent(task);
                    }
                }

                if (isSdkResultMessage(message)) {
                    resultMessage = message;
                }
            }

            clearTimeout(timer);

            if (timedOut) {
                throw new ProviderTimeoutError(timeoutMs);
            }

            if (!resultMessage) {
                logger.error("provider.exec.empty_response", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                });
                throw new ProviderEmptyOutputError();
            }

            if (resultMessage.subtype !== "success") {
                const output = resultMessage.errors.join("\n") || resultMessage.subtype;
                logger.error("provider.exec.api_error", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                    subtype: resultMessage.subtype,
                    errors: resultMessage.errors.slice(0, 5),
                    sessionId: resultMessage.session_id,
                });
                throw new ProviderProcessError(1, output);
            }

            if (compactError) {
                logger.error("provider.exec.compact_failed", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                    sessionId: resultMessage.session_id,
                    error: compactError,
                });
                throw new ProviderProcessError(1, compactError);
            }

            const responseText = mergeStreamedAndFinalResponse(streamedResponseText, resultMessage.result);
            const contextWindow = extractContextWindowFromResult(resultMessage);
            const contextUsage = extractContextUsageFromCompactBoundary(
                compactBoundaryMessage,
                contextWindow,
            ) || extractContextUsageFromAssistant(
                lastAssistantMessage,
                contextWindow,
            ) || extractContextUsageFromResult(resultMessage);

            if (!responseText && !opts.rawProviderCommand) {
                logger.error("provider.exec.empty_response", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                    sessionId: resultMessage.session_id,
                });
                throw new ProviderEmptyOutputError();
            }

            logger.info("provider.exec.success", {
                provider: this.type,
                workdir,
                sandbox,
                durationMs: Date.now() - startedAt,
                replyChars: responseText.length,
                sessionId: resultMessage.session_id,
                modelUsage: Object.keys(resultMessage.modelUsage || {}),
                totalCostUsd: resultMessage.total_cost_usd,
            });

            await onEvent?.({
                type: "agent_status",
                status: "completed",
                message: "Claude Code Agent 已完成",
                sessionId: resultMessage.session_id,
                durationMs: Date.now() - startedAt,
            });

            return {
                text: responseText,
                sessionId: resultMessage.session_id,
                contextUsage,
            };
        } catch (err) {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abortFromSignal);

            if (timedOut) {
                logger.warn("provider.exec.timeout", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                });
                throw new ProviderTimeoutError(timeoutMs);
            }

            if (signal?.aborted) {
                logger.info("provider.exec.cancelled", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                });
                await onEvent?.({
                    type: "agent_status",
                    status: "failed",
                    message: "Claude Code Agent 已中断",
                    durationMs: Date.now() - startedAt,
                });
                throw new ProviderCancelledError();
            }

            logger.error("provider.exec.error", {
                provider: this.type,
                workdir,
                sandbox,
                durationMs: Date.now() - startedAt,
                error: err,
            });
            await onEvent?.({
                type: "agent_status",
                status: "failed",
                message: err instanceof Error ? err.message : "Claude Code Agent 执行失败",
                durationMs: Date.now() - startedAt,
            });
            throw err;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abortFromSignal);
        }
    }

    private resolveModelAlias(model: string | undefined): string | undefined {
        if (!model) return undefined;
        if (model === "claude-opus-4-7") return this.anthropicOpusModel || model;
        if (model === "claude-sonnet-4-6") return this.anthropicSonnetModel || model;
        return model;
    }

    private hasAnthropicCompatConfig(): boolean {
        return Boolean(
            this.apiKey ||
            this.apiKeyHelper ||
            this.anthropicBaseUrl ||
            this.anthropicAutoModel ||
            this.defaultModel ||
            this.anthropicOpusModel ||
            this.anthropicSonnetModel ||
            this.anthropicHaikuModel ||
            this.claudeCodeSubagentModel
        );
    }

    private getIsolatedClaudeConfigDir(): string {
        const dir = path.join(getDataDir(), "claude-code");
        mkdirSync(dir, {recursive: true});
        return dir;
    }

    private applyAnthropicEnv(env: NodeJS.ProcessEnv): void {
        if (this.apiKey) env.ANTHROPIC_API_KEY = this.apiKey;
        if (this.anthropicBaseUrl) env.ANTHROPIC_BASE_URL = this.anthropicBaseUrl;
        if (this.anthropicAutoModel || this.defaultModel) {
            env.ANTHROPIC_MODEL = this.anthropicAutoModel || this.defaultModel;
        }
        if (this.anthropicOpusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = this.anthropicOpusModel;
        if (this.anthropicSonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = this.anthropicSonnetModel;
        if (this.anthropicHaikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.anthropicHaikuModel;
        if (this.claudeCodeSubagentModel) env.CLAUDE_CODE_SUBAGENT_MODEL = this.claudeCodeSubagentModel;
    }
}
