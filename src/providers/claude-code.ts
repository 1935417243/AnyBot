import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
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
    ProviderStreamEvent,
    ProviderSlashCommand,
    RunOptions,
    RunResult,
} from "./types.js";
import {ProviderCancelledError} from "./types.js";
import {ProviderEmptyOutputError, ProviderProcessError, ProviderTimeoutError, PROVIDER_HARD_ABORT_GRACE_MS,} from "./codex.js";
import {
    type ClaudeAgentStreamEvent,
    type ClaudeAgentTodoItem,
    createFileChangeEvent,
    createTaskEvent,
    createTaskTodoEvent,
    createToolEndEvent,
    createToolProgressEvent,
    createToolStartEvent,
    createTodoUpdateEvent,
    extractAssistantTextDelta,
    extractAssistantThinkingDelta,
} from "./claude-code-agent-events.js";
import {DEFAULT_PROVIDER_TIMEOUT_MS} from "../app-settings.js";
import {logger} from "../logger.js";
import {DEFAULT_SANDBOX} from "../sandbox-config.js";
import type {SandboxMode} from "../types.js";
import {getClaudeConfigDir, getClaudeSkillsDir, getIsolatedClaudeConfigDir} from "../claude-config.js";
import {getClaudeMcpServersConfig} from "../mcp-config.js";

const DEFAULT_TIMEOUT_MS = DEFAULT_PROVIDER_TIMEOUT_MS;
const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: unknown };
const appVersion = typeof packageJson.version === "string" && packageJson.version.trim()
    ? packageJson.version.trim()
    : "0.0.0";

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

type ClaudeSkillsMapping = {
    sourceDir: string;
    runtimeDir: string;
    mode: "same-config" | "created-symlink" | "existing-symlink" | "existing-directory" | "failed";
    error?: string;
};

function normalizeFsPath(value: string): string {
    return path.resolve(value).normalize("NFC");
}

function isSamePath(left: string, right: string): boolean {
    return normalizeFsPath(left) === normalizeFsPath(right);
}

function ensureClaudeSkillsAvailableInConfigDir(runtimeConfigDir: string): ClaudeSkillsMapping {
    const sourceConfigDir = getClaudeConfigDir();
    const sourceDir = getClaudeSkillsDir();
    const runtimeDir = path.join(runtimeConfigDir, "skills");

    if (isSamePath(sourceConfigDir, runtimeConfigDir)) {
        return {sourceDir, runtimeDir, mode: "same-config"};
    }

    try {
        fs.mkdirSync(sourceDir, {recursive: true});
        fs.mkdirSync(runtimeConfigDir, {recursive: true});

        if (fs.existsSync(runtimeDir)) {
            const stat = fs.lstatSync(runtimeDir);
            if (stat.isSymbolicLink()) {
                const target = path.resolve(path.dirname(runtimeDir), fs.readlinkSync(runtimeDir));
                if (!isSamePath(target, sourceDir)) {
                    fs.rmSync(runtimeDir, {force: true});
                    fs.symlinkSync(sourceDir, runtimeDir, process.platform === "win32" ? "junction" : "dir");
                    return {sourceDir, runtimeDir, mode: "created-symlink"};
                }
                return {sourceDir, runtimeDir, mode: "existing-symlink"};
            }
            return {sourceDir, runtimeDir, mode: "existing-directory"};
        }

        fs.symlinkSync(sourceDir, runtimeDir, process.platform === "win32" ? "junction" : "dir");
        return {sourceDir, runtimeDir, mode: "created-symlink"};
    } catch (err) {
        return {
            sourceDir,
            runtimeDir,
            mode: "failed",
            error: err instanceof Error ? err.message : String(err),
        };
    }
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
    private readonly timeoutMs: number;
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
        timeoutMs?: number;
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
        this.timeoutMs = opts?.timeoutMs || DEFAULT_TIMEOUT_MS;
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
        const autoMapped = this.anthropicAutoModel || this.defaultModel;

        return [
            {
                id: "auto",
                name: autoMapped || "Auto",
                description: "使用 Claude Code 默认模型"
            },
            {
                id: "claude-sonnet-4-6",
                name: this.anthropicSonnetModel || "Claude Sonnet 4.6",
                description: "默认推荐，均衡能力与速度"
            },
            {
                id: "claude-opus-4-7",
                name: this.anthropicOpusModel || "Claude Opus 4.7",
                description: "最强复杂任务模型"
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
            onEvent: (event: ProviderStreamEvent) => void | Promise<void>;
        },
    ): Promise<RunResult> {
        return this.execute(opts, opts.onEvent);
    }

    private async execute(
        opts: RunOptions,
        onEvent?: (event: ProviderStreamEvent) => void | Promise<void>,
    ): Promise<RunResult> {
        const {
            workdir,
            model,
            effort,
            sessionId,
            newSessionId,
            timeoutMs = this.timeoutMs,
            signal,
        } = opts;
        const prompt = opts.rawProviderCommand
            ? opts.prompt
            : `${WORKDIR_SAFETY_PROMPT}\n\n${opts.prompt}`;
        const sandbox = opts.sandbox ?? DEFAULT_SANDBOX;
        const startedAt = Date.now();
        const abortController = new AbortController();
        // 包装 abort，任何触发点都记录来源调用栈，用于排查“完全访问下工具仍被取消”的根因
        const rawAbort = abortController.abort.bind(abortController);
        abortController.abort = (reason?: unknown) => {
            logger.warn("provider.exec.abort.triggered", {
                provider: this.type,
                workdir,
                reason: reason instanceof Error ? reason.message : reason ? String(reason) : null,
                callerStack: new Error("abort caller").stack,
            });
            rawAbort(reason);
        };
        const permissionMode = this.permissionMode ?? mapSandboxToPermissionMode(sandbox);
        const useAnthropicCompat = this.hasAnthropicCompatConfig();
        const claudeConfigDir = useAnthropicCompat ? getIsolatedClaudeConfigDir() : undefined;
        const claudeSkillsMapping = claudeConfigDir
            ? ensureClaudeSkillsAvailableInConfigDir(claudeConfigDir)
            : null;
        const resultModel = this.resolveModelAlias(model && model !== "auto" ? model : undefined)
            || this.anthropicAutoModel
            || this.defaultModel;
        // ultracode 是 AnyBot 的 UI 档位，SDK 侧没有对应取值，等价于 xhigh
        const sdkEffort = effort === "ultracode" ? "xhigh" : effort;
        const mcpServers = getClaudeMcpServersConfig() as Options["mcpServers"] | undefined;

        let timedOut = false;
        let hardExpired = false;
        let closeStream: (() => void) | null = null;
        let hardTimer: NodeJS.Timeout | null = null;
        let rejectHardDeadline: (error: Error) => void = () => {};
        const hardDeadline = new Promise<never>((_resolve, reject) => {
            rejectHardDeadline = reject;
        });
        // 硬超时兜底触发后丢弃后台残留事件，避免 turn 已失败返回后仍向会话推流
        const emitEvent: typeof onEvent = onEvent
            ? (event) => (hardExpired ? undefined : onEvent(event))
            : undefined;
        const timer = setTimeout(() => {
            timedOut = true;
            abortController.abort();
            // abort 只是请求 SDK 停止；若事件流迟迟不结束，关闭 stream 并强制让本次 turn 失败返回
            hardTimer = setTimeout(() => {
                hardExpired = true;
                closeStream?.();
                rejectHardDeadline(new ProviderTimeoutError(timeoutMs));
            }, PROVIDER_HARD_ABORT_GRACE_MS);
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
            claudeSkillsDir: claudeSkillsMapping?.sourceDir || getClaudeSkillsDir(),
            claudeRuntimeSkillsDir: claudeSkillsMapping?.runtimeDir || null,
            claudeSkillsMapping: claudeSkillsMapping?.mode || null,
            claudeSkillsMappingError: claudeSkillsMapping?.error || null,
            workdir,
            sandbox,
            model: resultModel || null,
            effort: sdkEffort || null,
            anthropicBaseUrl: this.anthropicBaseUrl || null,
            anthropicAutoModel: this.anthropicAutoModel || this.defaultModel || null,
            anthropicOpusModel: this.anthropicOpusModel || null,
            anthropicSonnetModel: this.anthropicSonnetModel || null,
            anthropicHaikuModel: this.anthropicHaikuModel || null,
            claudeCodeSubagentModel: this.claudeCodeSubagentModel || null,
            mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
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
                CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || `anybot/${appVersion}`,
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

            await emitEvent?.({
                type: "agent_status",
                status: "started",
                message: "Claude Code Agent 已启动",
            });

            // 新版 SDK 用 TaskCreate/TaskUpdate 替代 TodoWrite，需跨 hook 维护待办任务表以合成全量 todo_update
            const todoTasks = new Map<string, ClaudeAgentTodoItem>();
            // 记录本轮内有工具被权限拒绝的子代理任务 id，用于结束时把 completed 降级为 failed
            const deniedTaskIds = new Set<string>();
            const hooks: Options["hooks"] | undefined = onEvent
                ? {
                    PreToolUse: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = createToolStartEvent(input, workdir);
                                    if (event) await emitEvent?.(event);
                                    const todoEvent = createTodoUpdateEvent(input);
                                    if (todoEvent) await emitEvent?.(todoEvent);
                                    const taskTodoEvent = createTaskTodoEvent(input, todoTasks);
                                    if (taskTodoEvent) await emitEvent?.(taskTodoEvent);
                                    return {};
                                },
                            ],
                        },
                    ],
                    TaskCreated: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = createTaskTodoEvent(input, todoTasks);
                                    if (event) await emitEvent?.(event);
                                    return {};
                                },
                            ],
                        },
                    ],
                    TaskCompleted: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = createTaskTodoEvent(input, todoTasks);
                                    if (event) await emitEvent?.(event);
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
                                    if (event) await emitEvent?.(event);
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
                                    if (event) await emitEvent?.(event);
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
                                    if (event) await emitEvent?.(event);
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
                    effort: sdkEffort,
                    resume: sessionId,
                    sessionId: sessionId ? undefined : newSessionId,
                    pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable,
                    maxTurns: this.maxTurns,
                    permissionMode,
                    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
                    allowedTools: buildAllowedTools(sandbox),
                    tools: {type: "preset", preset: "claude_code"},
                    systemPrompt: {type: "preset", preset: "claude_code"},
                    settingSources: ["user", "project", "local"],
                    skills: "all",
                    mcpServers,
                    sandbox: buildSandboxOptions(sandbox, workdir),
                    includePartialMessages: !!onEvent,
                    agentProgressSummaries: !!onEvent,
                    hooks,
                    env,
                    settings: flagSettings,
                    // 临时开启 CLI debug 日志（经 stderr 回调落入 .run 日志），排查工具被 CLI 内部取消的根因，定位后移除
                    debug: true,
                    // 捕获 CLI 自身 stderr 诊断输出，用于排查 CLI 内部取消工具调用的原因
                    stderr: (data) => {
                        logger.warn("provider.exec.cli_stderr", {
                            provider: this.type,
                            workdir,
                            data: data.slice(0, 500),
                        });
                    },
                },
            });

            closeStream = () => {
                try {
                    stream.close();
                } catch {
                    // 忽略关闭失败，硬 deadline 仍会强制结束本次 turn
                }
            };

            const consuming = (async () => {
                for await (const message of stream) {
                    // permission_denied 是排查权限问题的关键线索，完整落日志（含 agent_id、拒绝原因类型）
                    if (message.type === "system" && (message as {subtype?: string}).subtype === "permission_denied") {
                        const denied = message as {
                            tool_name?: string;
                            tool_use_id?: string;
                            agent_id?: string;
                            decision_reason_type?: string;
                            decision_reason?: string;
                            message?: string;
                        };
                        logger.warn("provider.exec.permission_denied", {
                            provider: this.type,
                            workdir,
                            toolName: denied.tool_name || null,
                            toolUseId: denied.tool_use_id || null,
                            agentId: denied.agent_id || null,
                            decisionReasonType: denied.decision_reason_type || null,
                            decisionReason: denied.decision_reason || null,
                            message: denied.message || null,
                        });
                    }
                    if (isSdkAssistantMessage(message)) {
                        lastAssistantMessage = message;
                    }
                    if (isSdkCompactBoundaryMessage(message)) {
                        compactBoundaryMessage = message;
                    }
                    if (isSdkStatusMessage(message) && message.compact_result === "failed") {
                        compactError = message.compact_error || "Claude Code 上下文压缩失败";
                    }

                    if (emitEvent) {
                        const delta = extractAssistantTextDelta(message);
                        if (delta) {
                            streamedResponseText += delta;
                            await emitEvent({type: "answer_delta", text: delta});
                        }

                        const thinking = extractAssistantThinkingDelta(message);
                        if (thinking) {
                            await emitEvent({type: "thinking_delta", text: thinking});
                        }

                        const progress = createToolProgressEvent(message);
                        if (progress) {
                            await emitEvent(progress);
                        }

                        const task = createTaskEvent(message, deniedTaskIds);
                        if (task) {
                            await emitEvent(task);
                        }
                    }

                    if (isSdkResultMessage(message)) {
                        resultMessage = message;
                    }
                }
                // 返回值用于把闭包内的赋值带回主流程，保持后续控制流收窄有效
                return {resultMessage, lastAssistantMessage, compactBoundaryMessage, compactError, streamedResponseText};
            })();
            // SDK 忽略 abort 时 for-await 可能永不结束；硬 deadline 强制 reject，由后台残留的 consuming 自行收尾
            consuming.catch(() => {});
            const consumed = await Promise.race([consuming, hardDeadline]);
            resultMessage = consumed.resultMessage;
            lastAssistantMessage = consumed.lastAssistantMessage;
            compactBoundaryMessage = consumed.compactBoundaryMessage;
            compactError = consumed.compactError;
            streamedResponseText = consumed.streamedResponseText;

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
            if (hardTimer) clearTimeout(hardTimer);
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
