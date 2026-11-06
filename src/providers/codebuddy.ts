import {
    type AssistantMessage,
    type Message,
    type Options,
    type PermissionMode,
    query,
    type ResultMessage,
} from "@tencent-ai/agent-sdk";
import type {
    HookInput as ClaudeHookInput,
    SDKMessage as ClaudeSDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    AppMcpServerConnection,
    IProvider,
    ProviderCapabilities,
    ProviderContextUsage,
    ProviderModel,
    ProviderStreamEvent,
    ProviderUserQuestionItem,
    ProviderUserQuestionRequest,
    RunOptions,
    RunResult,
} from "./types.js";
import {ProviderCancelledError} from "./types.js";
import {ProviderEmptyOutputError, ProviderProcessError, ProviderTimeoutError, PROVIDER_HARD_ABORT_GRACE_MS,} from "./codex.js";
import {
    createTaskEvent,
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
import {getAppMcpAllowedTools, getAppMcpDisallowedTools, getClaudeMcpServersConfig} from "../mcp-config.js";
import {getCliExecutablePath} from "../cli-runtime/installer.js";
import {emitModelConfigChanged} from "../web/events.js";

const DEFAULT_TIMEOUT_MS = DEFAULT_PROVIDER_TIMEOUT_MS;
/** AnyBot 的 CodeBuddy 场景仅使用中国区，避免 CLI 根据 Windows 历史登录状态误判为国际区 */
const CODEBUDDY_ENVIRONMENT = "internal" as const;

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

/** CodeBuddy 向用户提问的内置工具名 */
const ASK_USER_QUESTION_TOOL = "AskUserQuestion";
/** 非提问工具的审批沿用 SDK 未提供处理器时的拒绝文案，保持原有权限行为不变 */
const NO_PERMISSION_HANDLER_MESSAGE = "No permission handler provided";
/** CLI 识别的「用户跳过全部问题」答案标记，CLI 要求 answers 非空，跳过时也必须回传 */
const SKIP_QUESTION_ANSWERS = {_action: "skip_question"};

/** 把 AskUserQuestion 工具入参整理为提问请求；没有有效问题时返回 null */
function parseAskUserQuestionInput(
    toolUseId: string,
    input: Record<string, unknown>,
): ProviderUserQuestionRequest | null {
    let rawQuestions: unknown = input.questions;
    if (typeof rawQuestions === "string") {
        try {
            rawQuestions = JSON.parse(rawQuestions);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(rawQuestions)) return null;

    const questions = rawQuestions.flatMap((rawItem): ProviderUserQuestionItem[] => {
        if (!rawItem || typeof rawItem !== "object") return [];
        const item = rawItem as Record<string, unknown>;
        const question = typeof item.question === "string" ? item.question : "";
        if (!question.trim()) return [];
        const rawOptions = Array.isArray(item.options) ? item.options : [];
        const options = rawOptions.flatMap((rawOption) => {
            if (typeof rawOption === "string") {
                return rawOption.trim() ? [{label: rawOption.trim(), description: ""}] : [];
            }
            if (!rawOption || typeof rawOption !== "object") return [];
            const option = rawOption as Record<string, unknown>;
            const label = typeof option.label === "string" ? option.label.trim() : "";
            if (!label) return [];
            return [{
                label,
                description: typeof option.description === "string" ? option.description : "",
            }];
        });
        return [{
            question,
            header: typeof item.header === "string" ? item.header : "",
            options,
            multiSelect: item.multiSelect === true,
        }];
    });

    return questions.length > 0 ? {id: toolUseId, questions} : null;
}

function isSdkResultMessage(message: Message): message is ResultMessage {
    return message.type === "result";
}

/** 判断是否为 SDK 找不到 CLI 二进制的错误（未下载内置组件且 dev 环境也无随包 CLI 时触发） */
function isMissingCliBinaryError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.name === "CLIStartupError"
        || err.message.includes("ENOENT")
        || (err.message.includes("CLI") && err.message.includes("not found"));
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

/** CodeBuddy SDK 的沙箱设置仅支持 enabled/autoAllowBashIfSandboxed，文件系统边界由权限模式与工具白名单兜底 */
function buildSandboxOptions(sandbox: SandboxMode): Options["sandbox"] {
    if (sandbox === "danger-full-access") {
        return {enabled: false};
    }
    return {
        enabled: true,
        autoAllowBashIfSandboxed: sandbox === "workspace-write",
    };
}

function buildAllowedTools(sandbox: SandboxMode, appMcpServer?: AppMcpServerConnection): string[] | undefined {
    if (sandbox === "danger-full-access") {
        return undefined;
    }

    const baseTools = sandbox === "workspace-write" ? WORKSPACE_WRITE_TOOLS : READ_ONLY_TOOLS;
    // 内置 MCP 工具只操作 AnyBot 自身配置，不受沙箱档位限制，注入时一并放行
    return [...baseTools, ...getAppMcpAllowedTools(appMcpServer)];
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

/** CLI 写入 result._meta 的当前上下文占用（最近一次请求的输入 token，已含缓存命中） */
const CONTEXT_USED_META_KEY = "codebuddy.ai/contextUsed";
/** CLI 写入 result._meta 的有效上下文窗口；仅在 CBC_SESSION_CONFIG_SYNC=1 时下发，默认需用 modelUsage 兜底 */
const CONTEXT_WINDOW_META_KEY = "codebuddy.ai/contextWindow";

/** CLI 运行时附加在 result 消息上、但 SDK d.ts 未声明的用量字段 */
interface CodeBuddyResultUsageExtras {
    /** 按模型聚合的整轮 token 用量（计费口径），contextWindow 取自模型配置的 maxInputTokens */
    modelUsage?: Record<string, {contextWindow?: number} | undefined>;
    /** ACP 扩展元数据，含 codebuddy.ai/contextUsed、codebuddy.ai/contextWindow 等字段 */
    _meta?: Record<string, unknown>;
}

/** 判断是否为 SDK 的 assistant 消息 */
function isSdkAssistantMessage(message: Message): message is AssistantMessage {
    return message.type === "assistant";
}

/** 读取有限正数，缺失或非法值统一返回 0 */
function getPositiveNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 组装上下文占用；已用或窗口大小缺失时返回 undefined，前端保持空态 */
function buildContextUsage(
    usedTokens: number,
    maxTokens: number,
    tokenBreakdown?: Partial<Pick<ProviderContextUsage, "inputTokens" | "outputTokens" | "cacheReadInputTokens">>,
): ProviderContextUsage | undefined {
    if (usedTokens <= 0 || maxTokens <= 0) return undefined;

    const usedPercentage = Math.min(100, Math.round((usedTokens / maxTokens) * 1000) / 10);
    return {
        usedTokens,
        maxTokens,
        usedPercentage,
        remainingPercentage: Math.max(0, Math.round((100 - usedPercentage) * 10) / 10),
        ...tokenBreakdown,
        source: "codebuddy",
    };
}

/**
 * 解析本轮结束时的上下文占用。
 * 窗口大小：优先 _meta 下发值，否则按最后一条主代理回复的模型取 modelUsage[model].contextWindow。
 * 已用：优先 CLI 计算的 contextUsed；续聊且未显式指定模型时 CLI 会跳过该字段，此时用最后一次请求的 usage。
 * CodeBuddy 的 input_tokens 已包含缓存命中，不能再叠加 cache_read_input_tokens；
 * modelUsage 的 token 是整轮累加值，不能用来估算当前占用。
 */
function extractContextUsage(
    result: ResultMessage,
    lastAssistantMessage: AssistantMessage | null,
): ProviderContextUsage | undefined {
    const extras = result as unknown as CodeBuddyResultUsageExtras;
    const modelUsage = extras.modelUsage || {};
    const assistantModel = lastAssistantMessage?.message.model;
    const maxTokens = getPositiveNumber(extras._meta?.[CONTEXT_WINDOW_META_KEY])
        || (assistantModel ? getPositiveNumber(modelUsage[assistantModel]?.contextWindow) : 0)
        || Object.values(modelUsage).map((entry) => getPositiveNumber(entry?.contextWindow)).find((value) => value > 0)
        || 0;

    const contextUsed = getPositiveNumber(extras._meta?.[CONTEXT_USED_META_KEY]);
    if (contextUsed) return buildContextUsage(contextUsed, maxTokens);

    const usage = lastAssistantMessage?.message.usage;
    const inputTokens = getPositiveNumber(usage?.input_tokens);
    const outputTokens = getPositiveNumber(usage?.output_tokens);
    return buildContextUsage(inputTokens + outputTokens, maxTokens, {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: getPositiveNumber(usage?.cache_read_input_tokens),
    });
}

/** 模型清单兜底（尚未从 CLI 实时拉取成功前仅暴露 Auto） */
const FALLBACK_MODELS: ProviderModel[] = [
    {
        id: "auto",
        name: "Auto",
        description: "使用 CodeBuddy 默认模型",
    },
];
/** 实时拉取成功的模型清单缓存（不含 auto，listModels 时拼装） */
let cachedRemoteModels: ProviderModel[] | null = null;
let modelsLastFetchAt = 0;
let modelsFetchInflight: Promise<void> | null = null;
/** 模型清单缓存有效期，过期后下次 listModels 触发后台重新拉取 */
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
/** 拉取模型清单（spawn CLI + initialize 控制请求）的超时 */
const MODELS_FETCH_TIMEOUT_MS = 20_000;

export class CodeBuddyProvider implements IProvider {
    readonly type = "codebuddy";
    readonly displayName = "CodeBuddy";
    readonly capabilities: ProviderCapabilities = {
        sessionResume: true,
        imageInput: false,
        sandbox: true,
    };

    private readonly pathToCodebuddyCode: string | undefined;
    private readonly maxTurns: number | undefined;
    private readonly timeoutMs: number;
    private readonly permissionMode: PermissionMode | undefined;
    private readonly apiKey: string | undefined;

    constructor(opts?: {
        pathToCodebuddyCode?: string;
        maxTurns?: number;
        timeoutMs?: number;
        permissionMode?: PermissionMode;
        apiKey?: string;
    }) {
        this.pathToCodebuddyCode = opts?.pathToCodebuddyCode;
        this.maxTurns = opts?.maxTurns;
        this.timeoutMs = opts?.timeoutMs || DEFAULT_TIMEOUT_MS;
        this.permissionMode = opts?.permissionMode;
        this.apiKey = opts?.apiKey;
    }

    listModels(): ProviderModel[] {
        this.refreshModelsIfStale();
        const remote = cachedRemoteModels;
        if (!remote || remote.length === 0) return FALLBACK_MODELS;
        // 远程清单通常自带 auto；没有则补上兜底项，保证始终有可选模型
        return remote.some((model) => model.id === "auto")
            ? remote
            : [...FALLBACK_MODELS, ...remote];
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

    /**
     * 模型清单实时拉取：缓存过期时后台 spawn 一个 CLI 进程发 initialize 控制请求
     * 取 supportedModels（不消费对话轮次），成功后广播 model_config_changed 让前端刷新
     */
    private refreshModelsIfStale(): void {
        if (modelsFetchInflight) return;
        const now = Date.now();
        if (cachedRemoteModels && now - modelsLastFetchAt < MODELS_CACHE_TTL_MS) return;
        if (!this.resolveCliExecutable()) return;

        modelsFetchInflight = this.fetchSupportedModels()
            .then((models) => {
                if (models.length > 0) {
                    const changed = JSON.stringify(models) !== JSON.stringify(cachedRemoteModels);
                    cachedRemoteModels = models;
                    if (changed) emitModelConfigChanged(this.type, "models_refreshed");
                }
                modelsLastFetchAt = Date.now();
            })
            .catch((err) => {
                logger.warn("provider.models.refresh_failed", {
                    provider: this.type,
                    error: err instanceof Error ? err.message : String(err),
                });
                // 失败也记录时间，避免每次 listModels 都重试 spawn
                modelsLastFetchAt = Date.now();
            })
            .finally(() => {
                modelsFetchInflight = null;
            });
    }

    /** 通过 SDK 控制通道拉取 CLI 当前支持的模型列表（不发 prompt，不消耗轮次） */
    private async fetchSupportedModels(): Promise<ProviderModel[]> {
        const env: NodeJS.ProcessEnv = {...process.env};
        env.CODEBUDDY_INTERNET_ENVIRONMENT = CODEBUDDY_ENVIRONMENT;
        if (this.apiKey) env.CODEBUDDY_API_KEY = this.apiKey;
        const stream = query({
            prompt: "",
            options: {
                environment: CODEBUDDY_ENVIRONMENT,
                pathToCodebuddyCode: this.resolveCliExecutable(),
                permissionMode: "plan",
                env,
            },
        });
        try {
            const models = await Promise.race([
                stream.supportedModels(),
                new Promise<never>((_resolve, reject) => {
                    setTimeout(() => reject(new Error("获取模型列表超时")), MODELS_FETCH_TIMEOUT_MS);
                }),
            ]);
            logger.info("provider.models.raw_response", {
                provider: this.type,
                models,
            });
            // CLI 实际返回 { id, name }（d.ts 声明的 ModelInfo 字段名与运行时不一致），做容错映射
            return models
                .map((model) => {
                    const raw = model as unknown as {
                        id?: string;
                        value?: string;
                        name?: string;
                        displayName?: string;
                        description?: string;
                    };
                    const id = raw.id ?? raw.value ?? "";
                    return {
                        id,
                        name: id,
                        description: raw.description ?? "",
                    };
                })
                .filter((model) => model.id);
        } finally {
            // cleanup 是 Query 的运行时方法（d.ts 未声明），用于关闭 CLI 子进程
            (stream as unknown as { cleanup?: () => void }).cleanup?.();
        }
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
        const resultModel = model && model !== "auto" ? model : undefined;
        // ultracode 是 AnyBot 的 UI 档位，SDK 侧没有对应取值，等价于 xhigh
        const sdkEffort = effort === "ultracode" ? "xhigh" : effort;
        const mcpServers = getClaudeMcpServersConfig(opts.appMcpServer) as Options["mcpServers"] | undefined;
        // 执行时实时解析 CLI 路径，组件后下载完成也能立即生效
        const cliExecutable = this.resolveCliExecutable();

        let timedOut = false;
        let hardExpired = false;
        let hardTimer: NodeJS.Timeout | null = null;
        let rejectHardDeadline: (error: Error) => void = () => {};
        const hardDeadline = new Promise<never>((_resolve, reject) => {
            rejectHardDeadline = reject;
        });
        // 硬超时兜底触发后丢弃后台残留事件，避免 turn 已失败返回后仍向会话推流
        const emitEvent: typeof onEvent = onEvent
            ? (event) => (hardExpired ? undefined : onEvent(event))
            : undefined;
        /** 本轮执行超时：请求 SDK 停止，并启动硬超时兜底 */
        const handleTurnTimeout = () => {
            timedOut = true;
            abortController.abort();
            // abort 只是请求 SDK 停止；若事件流迟迟不结束，强制让本次 turn 失败返回
            hardTimer = setTimeout(() => {
                hardExpired = true;
                rejectHardDeadline(new ProviderTimeoutError(timeoutMs));
            }, PROVIDER_HARD_ABORT_GRACE_MS);
        };
        /** 本轮剩余的超时预算，等待用户回复提问期间暂停扣减 */
        let timeoutRemainingMs = timeoutMs;
        /** 当前这段超时计时的起点 */
        let timeoutStartedAt = Date.now();
        /** 正在等待用户回复的提问数，大于 0 时暂停超时计时 */
        let pendingQuestionCount = 0;
        /** 本轮是否已结束，结束后不再恢复超时计时 */
        let turnSettled = false;
        let timer: NodeJS.Timeout | undefined = setTimeout(handleTurnTimeout, timeoutMs);
        /** 开始等待用户回复：暂停超时计时，用户思考时间不计入执行超时 */
        const pauseTurnTimeout = () => {
            pendingQuestionCount += 1;
            if (pendingQuestionCount > 1 || !timer) return;
            clearTimeout(timer);
            timer = undefined;
            timeoutRemainingMs = Math.max(0, timeoutRemainingMs - (Date.now() - timeoutStartedAt));
        };
        /** 用户回复结束：按剩余预算恢复超时计时 */
        const resumeTurnTimeout = () => {
            pendingQuestionCount = Math.max(0, pendingQuestionCount - 1);
            if (pendingQuestionCount > 0 || timer || timedOut || turnSettled) return;
            timeoutStartedAt = Date.now();
            timer = setTimeout(handleTurnTimeout, timeoutRemainingMs);
        };
        /** 提问等待的中断信号：本轮被中断或结束时释放仍在等待的提问 */
        const questionAbortController = new AbortController();
        abortController.signal.addEventListener("abort", () => questionAbortController.abort(), {once: true});
        const askUserQuestion = opts.askUserQuestion;
        /** 只接管 AskUserQuestion 的审批，其它工具按 SDK 未提供处理器时的方式拒绝 */
        const canUseTool: Options["canUseTool"] | undefined = askUserQuestion
            ? async (toolName, input, {toolUseID}) => {
                if (toolName !== ASK_USER_QUESTION_TOOL) {
                    return {behavior: "deny", message: NO_PERMISSION_HANDLER_MESSAGE};
                }
                const request = parseAskUserQuestionInput(toolUseID, input);
                if (!request) {
                    return {behavior: "deny", message: "AskUserQuestion 参数无效"};
                }
                logger.info("provider.exec.ask_user_question", {
                    provider: this.type,
                    workdir,
                    questionId: toolUseID,
                    questionCount: request.questions.length,
                });
                pauseTurnTimeout();
                try {
                    const reply = await askUserQuestion(request, questionAbortController.signal);
                    return {
                        behavior: "allow",
                        updatedInput: {
                            ...input,
                            answers: reply.action === "skip" ? SKIP_QUESTION_ANSWERS : reply.answers,
                        },
                    };
                } finally {
                    resumeTurnTimeout();
                }
            }
            : undefined;
        const abortFromSignal = () => abortController.abort(signal?.reason);
        if (signal?.aborted) {
            abortFromSignal();
        } else {
            signal?.addEventListener("abort", abortFromSignal, {once: true});
        }

        logger.info("provider.exec.start", {
            provider: this.type,
            bin: cliExecutable || null,
            workdir,
            sandbox,
            model: resultModel || null,
            effort: sdkEffort || null,
            mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
            apiKeyConfigured: Boolean(this.apiKey),
            sessionId: sessionId || null,
            newSessionId: sessionId ? null : newSessionId || null,
            promptChars: prompt.length,
            timeoutMs,
            permissionMode,
        });

        try {
            let resultMessage: ResultMessage | null = null;
            /** 最后一条带用量的主代理回复，用于兜底计算上下文占用与匹配模型窗口 */
            let lastAssistantMessage: AssistantMessage | null = null;
            let streamedResponseText = "";
            const env: NodeJS.ProcessEnv = {...process.env};
            env.CODEBUDDY_INTERNET_ENVIRONMENT = CODEBUDDY_ENVIRONMENT;
            if (this.apiKey) {
                env.CODEBUDDY_API_KEY = this.apiKey;
            } else if (!env.CODEBUDDY_API_KEY) {
                delete env.CODEBUDDY_API_KEY;
            }

            await emitEvent?.({
                type: "agent_status",
                status: "started",
                message: "CodeBuddy Agent 已启动",
            });

            // 记录本轮内有工具被权限拒绝的子代理任务 id，用于结束时把 completed 降级为 failed
            const deniedTaskIds = new Set<string>();
            // CodeBuddy 与 Claude Agent SDK 的消息/Hook 结构一致，事件工厂通过结构化断言复用
            const toClaudeMessage = (message: Message) => message as unknown as ClaudeSDKMessage;
            const toClaudeHookInput = (input: unknown) => input as ClaudeHookInput;
            const hooks: Options["hooks"] | undefined = onEvent
                ? {
                    PreToolUse: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = createToolStartEvent(toClaudeHookInput(input), workdir);
                                    if (event) await emitEvent?.(event);
                                    const todoEvent = createTodoUpdateEvent(toClaudeHookInput(input));
                                    if (todoEvent) await emitEvent?.(todoEvent);
                                    return {};
                                },
                            ],
                        },
                    ],
                    PostToolUse: [
                        {
                            hooks: [
                                async (input) => {
                                    const event = await createToolEndEvent(toClaudeHookInput(input), workdir);
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
                                    const event = await createToolEndEvent(toClaudeHookInput(input), workdir);
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
                    environment: CODEBUDDY_ENVIRONMENT,
                    cwd: workdir,
                    model: resultModel,
                    // 显式开启自适应思考，避免依赖 CLI 或用户配置中的默认开关
                    thinking: {type: "adaptive"},
                    effort: sdkEffort,
                    resume: sessionId,
                    sessionId: sessionId ? undefined : newSessionId,
                    pathToCodebuddyCode: cliExecutable,
                    maxTurns: this.maxTurns,
                    permissionMode,
                    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
                    allowedTools: buildAllowedTools(sandbox, opts.appMcpServer),
                    // 注入内置 MCP 时禁用自带的会话级定时工具，定时需求统一走 AnyBot 自动化
                    disallowedTools: getAppMcpDisallowedTools(opts.appMcpServer),
                    settingSources: ["user", "project", "local"],
                    mcpServers,
                    sandbox: buildSandboxOptions(sandbox),
                    includePartialMessages: !!onEvent,
                    hooks,
                    canUseTool,
                    env,
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

            const consuming = (async () => {
                for await (const message of stream) {
                    // permission_denied 是排查权限问题的关键线索，完整落日志
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

                    if (emitEvent) {
                        const delta = extractAssistantTextDelta(toClaudeMessage(message));
                        if (delta) {
                            streamedResponseText += delta;
                            await emitEvent({type: "answer_delta", text: delta});
                        }

                        const thinking = extractAssistantThinkingDelta(toClaudeMessage(message));
                        if (thinking) {
                            await emitEvent({type: "thinking_delta", text: thinking});
                        }

                        const progress = createToolProgressEvent(toClaudeMessage(message));
                        if (progress) {
                            await emitEvent(progress);
                        }

                        const task = createTaskEvent(toClaudeMessage(message), deniedTaskIds);
                        if (task) {
                            await emitEvent(task);
                        }
                    }

                    // 子代理回复的用量反映的是子代理自己的上下文，不计入主会话
                    if (
                        isSdkAssistantMessage(message)
                        && !message.parent_tool_use_id
                        && getPositiveNumber(message.message?.usage?.input_tokens) > 0
                    ) {
                        lastAssistantMessage = message;
                    }

                    if (isSdkResultMessage(message)) {
                        resultMessage = message;
                    }
                }
                // 返回值用于把闭包内的赋值带回主流程，保持后续控制流收窄有效
                return {resultMessage, lastAssistantMessage, streamedResponseText};
            })();
            // SDK 忽略 abort 时 for-await 可能永不结束；硬 deadline 强制 reject，由后台残留的 consuming 自行收尾
            consuming.catch(() => {});
            const consumed = await Promise.race([consuming, hardDeadline]);
            resultMessage = consumed.resultMessage;
            lastAssistantMessage = consumed.lastAssistantMessage;
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
                const output = resultMessage.errors?.join("\n") || resultMessage.subtype;
                logger.error("provider.exec.api_error", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
                    subtype: resultMessage.subtype,
                    errors: (resultMessage.errors || []).slice(0, 5),
                    sessionId: resultMessage.session_id,
                });
                throw new ProviderProcessError(1, output);
            }

            const responseText = mergeStreamedAndFinalResponse(streamedResponseText, resultMessage.result);
            const contextUsage = extractContextUsage(resultMessage, lastAssistantMessage);

            if (!responseText && !opts.rawProviderCommand) {
                logger.error("provider.exec.empty_response", {
                    provider: this.type,
                    workdir,
                    sandbox,
                    durationMs: Date.now() - startedAt,
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
                totalCostUsd: resultMessage.total_cost_usd,
            });

            await onEvent?.({
                type: "agent_status",
                status: "completed",
                message: "CodeBuddy Agent 已完成",
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
                    message: "CodeBuddy Agent 已中断",
                    durationMs: Date.now() - startedAt,
                });
                throw new ProviderCancelledError();
            }

            // SDK 找不到 CLI 时的原始英文报错对用户不可读，替换为可操作的引导文案（原始错误仍完整落日志）
            const displayErr = isMissingCliBinaryError(err)
                ? new Error("CodeBuddy 组件未安装，请到「设置」页下载内置组件后重试")
                : err;

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
                message: displayErr instanceof Error ? displayErr.message : "CodeBuddy Agent 执行失败",
                durationMs: Date.now() - startedAt,
            });
            throw displayErr;
        } finally {
            turnSettled = true;
            clearTimeout(timer);
            if (hardTimer) clearTimeout(hardTimer);
            signal?.removeEventListener("abort", abortFromSignal);
            questionAbortController.abort();
        }
    }

    /**
     * 解析 CodeBuddy CLI 可执行文件路径：优先用构造时显式指定的值；
     * 为空时兜底重查按需下载的组件，覆盖 provider 创建后才完成下载的场景；
     * 再为空则由 SDK 自行解析随包 CLI（dev 环境下 node_modules 里有）
     */
    private resolveCliExecutable(): string | undefined {
        return this.pathToCodebuddyCode || getCliExecutablePath("codebuddy") || undefined;
    }
}
