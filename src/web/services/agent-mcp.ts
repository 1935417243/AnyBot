import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { channelManager, getRegisteredChannelTypes, readChannelsConfig } from "../../channels/index.js";
import { logger } from "../../logger.js";
import * as db from "../db.js";
import { getProviderTypes, readModelConfigForProvider } from "../model-config.js";
import { listSkillMentions } from "../skills.js";
import type { AgentMcpRunContext } from "./agent-mcp-grants.js";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  LOCAL_AUTOMATION_CHANNEL_TYPE,
  updateAutomation,
  validateAutomationInput,
  validateAutomationSchedule,
  type AutomationConfig,
  type AutomationInput,
  type AutomationScheduleConfig,
  type AutomationSkillConfig,
} from "./automations.js";

/** 内置 MCP Server 名称与版本，仅用于 MCP 握手展示 */
const SERVER_INFO = { name: "anybot", version: "1.0.0" };

/** 交付方式的中文名称；本地交付不推送，只保存在 AnyBot 的自动化运行记录和会话中 */
const DELIVERY_DISPLAY_NAMES: Record<string, string> = {
  [LOCAL_AUTOMATION_CHANNEL_TYPE]: "本地（只保存在 AnyBot，不推送）",
  weixin: "微信",
  telegram: "Telegram",
  feishu: "飞书",
  dingtalk: "钉钉",
  qqbot: "QQ",
};

/** 星期中文名，下标与 Date#getDay 一致（0 为周日） */
const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Agent 可用的触发类型 */
const AGENT_SCHEDULE_TYPES = ["once", "minutes", "hourly", "daily", "weekly", "cron"] as const;

/** 本地日期时间输入格式：YYYY-MM-DD HH:mm，也接受 T 分隔和秒 */
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 服务端指引：告诉 Agent 定时需求应该用这些工具，而不是系统定时任务 */
const SERVER_INSTRUCTIONS = [
  "AnyBot 内置工具，用于管理 AnyBot 的自动化（定时任务）。",
  "当用户希望定时执行任务、周期性汇报，或在某个时间点提醒/执行某事时，使用 automation_* 工具在 AnyBot 中创建自动化；",
  "不要用 crontab、launchd、系统计划任务或你自身的定时/循环能力代替。",
  "创建或修改前先调用 automation_options 获取当前时间、时区和可选项；修改或删除前先用 automation_list 找到任务 ID。",
  "自动化到点后会在一个全新会话中执行 prompt，看不到当前对话，所以 prompt 必须写成可独立执行的完整指令。",
  "所有时间均为本机时区。完成后向用户说明任务名称、触发方式、下次执行时间和交付方式。",
].join("\n");

/** 触发配置入参：按 type 填写对应字段，扁平结构兼容各 Provider 的工具参数解析 */
const scheduleInputSchema = z.object({
  type: z.enum(AGENT_SCHEDULE_TYPES).describe(
    "触发类型：once=仅执行一次；minutes=每隔 N 分钟；hourly=每小时；daily=每天固定时间；weekly=每周固定星期和时间；"
      + "cron=cron 表达式（daily/weekly 表达不了时再用，如工作日、每月 1 号）",
  ),
  at: z.string().optional().describe("type=once 时必填：执行时间，本机时区，格式 YYYY-MM-DD HH:mm，必须晚于当前时间"),
  intervalMinutes: z.number().optional().describe("type=minutes 时必填：间隔分钟数，大于 0 的整数"),
  time: z.string().optional().describe("type=daily 或 weekly 时必填：执行时间，HH:mm（24 小时制）"),
  weekday: z.number().optional().describe("type=weekly 时必填：0=周日，1=周一 … 6=周六"),
  cron: z.string().optional().describe(
    "type=cron 时必填：5 段表达式「分 时 日 月 周」，本机时区；只支持数字、*、a-b、逗号和 /步长，周 0 或 7 为周日；"
      + "日和周同时指定时需同时满足（与标准 cron 的“或”不同），例：0 9 * * 1-5 表示工作日 9:00",
  ),
});

/** 触发配置入参类型 */
type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/** 创建与修改共用的可选字段说明 */
const FIELD_DESCRIPTIONS = {
  name: "任务名称，简短概括任务，例如“每日 GitHub Trending 摘要”",
  prompt: [
    "到点后交给 Agent 执行的完整指令。执行时是全新会话，看不到当前对话，",
    "必须写清目标、数据来源、范围和输出格式等，不要写“按刚才说的做”；",
    "不需要写推送方式，执行结果会按 delivery 自动交付。",
  ].join(""),
  delivery: "交付方式：local 或已开启并记录了接收人的频道类型（取值见 automation_options.deliveries）",
  provider: "执行任务使用的 Provider 类型（取值见 automation_options.providers）",
  modelId: "模型 ID（取值见 automation_options.providers[].models）；null 表示跟随该 Provider 的默认模型",
  projectId: "执行时使用的项目 ID（取值见 automation_options.projects）；null 表示使用默认工作目录",
  skills: "执行时启用的技能 ID 列表（取值见 automation_options.skills），必须属于所选 Provider",
};

/** 把数据序列化为工具文本结果 */
function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** 构造工具错误结果，Agent 可据此修正参数后重试 */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** 两位数补零 */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 格式化为本机时区的 YYYY-MM-DD HH:mm 周X */
function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())} ${WEEKDAY_NAMES[date.getDay()]}`;
}

/** 描述本机时区，例如 Asia/Shanghai（UTC+08:00） */
function describeLocalTimezone(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `UTC${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone ? `${zone}（${offset}）` : offset;
}

/** 按本机时区解析 YYYY-MM-DD HH:mm；格式不对或日期不存在（如 02-30）时返回 null */
function parseLocalDateTime(text: string): number | null {
  const match = LOCAL_DATETIME_PATTERN.exec(text.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  const sameFields = date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute;
  return sameFields ? date.getTime() : null;
}

/** 用中文描述触发配置 */
function describeSchedule(schedule: AutomationScheduleConfig): string {
  if (schedule.type === "once") return schedule.runAt ? `仅一次：${formatLocalDateTime(schedule.runAt)}` : "仅一次（未设置时间）";
  if (schedule.type === "minutes") return `每 ${schedule.intervalMinutes || 30} 分钟`;
  if (schedule.type === "hourly") return "每小时";
  if (schedule.type === "daily") return `每天 ${schedule.time || "09:00"}`;
  if (schedule.type === "weekly") return `每${WEEKDAY_NAMES[schedule.weekday ?? 1]} ${schedule.time || "09:00"}`;
  return `cron：${schedule.cron || ""}`;
}

/** 交付方式的展示名 */
function deliveryLabel(type: string): string {
  return DELIVERY_DISPLAY_NAMES[type] || type;
}

/** 整理为返回给 Agent 的自动化摘要 */
function summarizeAutomation(automation: AutomationConfig): Record<string, unknown> {
  const project = automation.projectId ? db.getProject(automation.projectId) : null;
  return {
    id: automation.id,
    name: automation.name,
    enabled: automation.enabled,
    schedule: describeSchedule(automation.schedule),
    nextRunAt: automation.nextRunAt ? formatLocalDateTime(automation.nextRunAt) : null,
    provider: automation.provider,
    modelId: automation.modelId,
    project: project ? { id: project.id, name: project.name } : null,
    delivery: automation.channelType,
    deliveryName: deliveryLabel(automation.channelType),
    skills: automation.skills.map((skill) => skill.name),
    prompt: automation.prompt,
  };
}

/** 把触发配置入参转换为存储结构；只做格式转换，取值合法性交给 validateAutomationSchedule */
function buildScheduleFromInput(input: ScheduleInput): { schedule?: AutomationScheduleConfig; error?: string } {
  if (input.type === "once") {
    if (!input.at) return { error: "type=once 时必须提供 at（YYYY-MM-DD HH:mm）" };
    const runAt = parseLocalDateTime(input.at);
    if (runAt === null) return { error: `无法解析执行时间 ${input.at}，格式应为 YYYY-MM-DD HH:mm（本机时区）` };
    return { schedule: { type: "once", runAt } };
  }
  if (input.type === "minutes") {
    if (input.intervalMinutes === undefined) return { error: "type=minutes 时必须提供 intervalMinutes" };
    return { schedule: { type: "minutes", intervalMinutes: input.intervalMinutes } };
  }
  if (input.type === "hourly") return { schedule: { type: "hourly" } };
  if (input.type === "cron") {
    if (!input.cron?.trim()) return { error: "type=cron 时必须提供 cron（分 时 日 月 周）" };
    return { schedule: { type: "cron", cron: input.cron.trim() } };
  }
  if (!input.time) return { error: `type=${input.type} 时必须提供 time（HH:mm）` };
  if (input.type === "daily") return { schedule: { type: "daily", time: input.time } };
  if (input.weekday === undefined) return { error: "type=weekly 时必须提供 weekday（0=周日 … 6=周六）" };
  return { schedule: { type: "weekly", weekday: input.weekday, time: input.time } };
}

/** 新建自动化的默认交付方式：从频道发起的对话推回该频道，WebUI 发起的只保存在本地 */
function resolveDefaultDelivery(context: AgentMcpRunContext): string {
  return getRegisteredChannelTypes().includes(context.source) ? context.source : LOCAL_AUTOMATION_CHANNEL_TYPE;
}

/** 校验交付方式能否真正送达：频道需已开启且记录了接收人（ownerChatId） */
function validateDelivery(type: string, enabled: boolean): string | null {
  if (type === LOCAL_AUTOMATION_CHANNEL_TYPE || !enabled) return null;
  if (!getRegisteredChannelTypes().includes(type)) return `不支持的交付方式: ${type}，可选值见 automation_options.deliveries`;
  const config = readChannelsConfig()[type];
  const name = deliveryLabel(type);
  if (!config?.enabled) return `${name} 频道未开启，无法作为交付方式，可改用 local`;
  if (!config.ownerChatId) return `${name} 还没有记录接收人，请用户先在${name}里给机器人发一条消息，或改用 local`;
  return null;
}

/** 校验模型属于该 Provider；null 表示跟随默认模型 */
function validateModel(provider: string, modelId: string | null): string | null {
  if (!modelId) return null;
  const models = readModelConfigForProvider(provider).models;
  if (models.some((model) => model.id === modelId)) return null;
  return `模型 ${modelId} 不属于 ${provider}，可选值见 automation_options.providers[].models，或传 null 使用默认模型`;
}

/** 把技能 ID 解析为自动化技能配置；只接受该 Provider 下已启用的技能 */
function resolveSkills(provider: string, skillIds: string[]): { skills?: AutomationSkillConfig[]; error?: string } {
  const available = listSkillMentions(provider).filter((skill) => skill.enabled);
  const skills: AutomationSkillConfig[] = [];
  for (const id of skillIds) {
    const skill = available.find((item) => item.id === id);
    if (!skill) return { error: `技能 ${id} 不存在或未启用，可选值见 automation_options.skills` };
    if (!skills.some((item) => item.id === skill.id)) skills.push({ id: skill.id, name: skill.name, source: skill.source });
  }
  return { skills };
}

/** 统一校验即将写入的自动化配置，返回第一条错误 */
function validateAgentAutomation(input: AutomationInput): string | null {
  const enabled = input.enabled !== false;
  return validateAutomationInput(input)
    || validateAutomationSchedule(input.schedule, { enabled })
    || validateDelivery(input.channelType || "", enabled)
    || validateModel(input.provider || "", input.modelId ?? null);
}

/** automation_options：返回当前时间、会话默认值和全部可选项 */
function buildOptions(context: AgentMcpRunContext, providerType?: string): CallToolResult {
  const providers = getProviderTypes();
  const provider = providerType || context.provider;
  if (!providers.some((item) => item.type === provider)) return errorResult(`不支持的提供商: ${provider}`);
  const channelsConfig = readChannelsConfig();
  const deliveries = [
    { type: LOCAL_AUTOMATION_CHANNEL_TYPE, name: deliveryLabel(LOCAL_AUTOMATION_CHANNEL_TYPE), ready: true },
    ...getRegisteredChannelTypes()
      .filter((type) => channelsConfig[type]?.enabled)
      .map((type) => ({
        type,
        name: deliveryLabel(type),
        ready: Boolean(channelsConfig[type]?.ownerChatId) && Boolean(channelManager.getChannel(type)),
        note: channelsConfig[type]?.ownerChatId ? undefined : "还没有记录接收人，暂不能作为交付方式",
      })),
  ];
  const currentProject = context.projectId ? db.getProject(context.projectId) : null;
  return jsonResult({
    now: formatLocalDateTime(Date.now()),
    timezone: describeLocalTimezone(),
    defaults: {
      provider: context.provider,
      modelId: null,
      project: currentProject ? { id: currentProject.id, name: currentProject.name } : null,
      delivery: resolveDefaultDelivery(context),
      note: "创建时未传的字段使用这些默认值：Provider 和项目沿用当前会话，模型跟随 Provider 默认模型",
    },
    scheduleTypes: {
      once: "仅执行一次，at=YYYY-MM-DD HH:mm，执行后自动停用",
      minutes: "每隔 intervalMinutes 分钟",
      hourly: "每小时一次（从创建时刻起算）",
      daily: "每天 time=HH:mm",
      weekly: "每周 weekday（0=周日 … 6=周六）的 time=HH:mm",
      cron: "cron=「分 时 日 月 周」，日和周同时指定时需同时满足；daily/weekly 表达不了时再用",
    },
    providers: providers.map((item) => ({
      type: item.type,
      name: item.displayName,
      installed: item.installed,
      ...(item.type === provider
        ? { models: readModelConfigForProvider(item.type).models.map((model) => ({ id: model.id, name: model.name })) }
        : {}),
    })),
    deliveries,
    projects: db.listProjects().map((project) => ({ id: project.id, name: project.name, path: project.path })),
    skillsProvider: provider,
    skills: listSkillMentions(provider)
      .filter((skill) => skill.enabled)
      .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
    note: "models 和 skills 只列出 skillsProvider 对应 Provider 的选项，查看其它 Provider 请传 provider 参数",
  });
}

/** 为一次请求创建绑定了运行上下文的内置 MCP Server（无状态模式下每个请求一个实例） */
export function createAgentMcpServer(context: AgentMcpRunContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool("automation_options", {
    title: "查询自动化可选项",
    description: "查询创建 AnyBot 自动化（定时任务）需要的信息：当前时间与时区、当前会话的默认值、可用 Provider 与模型、交付方式、项目和技能。创建或修改自动化前先调用一次。",
    inputSchema: {
      provider: z.string().optional().describe("查看指定 Provider 的模型和技能；默认当前会话的 Provider"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ provider }) => buildOptions(context, provider));

  server.registerTool("automation_list", {
    title: "列出自动化",
    description: "列出 AnyBot 中已有的全部自动化（定时任务），包含 ID、启用状态、触发方式、下次执行时间、交付方式和执行内容。修改或删除前用它找到任务 ID。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const automations = listAutomations();
    return jsonResult({ total: automations.length, automations: automations.map(summarizeAutomation) });
  });

  server.registerTool("automation_create", {
    title: "创建自动化",
    description: "在 AnyBot 中新建一个自动化（定时任务），创建后立即启用，由 AnyBot 调度器到点自动执行。用户希望定时、周期性或在某个时间点执行任务/提醒时使用，不要用 crontab 或系统计划任务代替。",
    inputSchema: {
      name: z.string().describe(FIELD_DESCRIPTIONS.name),
      prompt: z.string().describe(FIELD_DESCRIPTIONS.prompt),
      schedule: scheduleInputSchema.describe("触发配置"),
      delivery: z.string().optional().describe(`${FIELD_DESCRIPTIONS.delivery}；默认：从频道发起的对话推回该频道，WebUI 发起为 local`),
      provider: z.string().optional().describe(`${FIELD_DESCRIPTIONS.provider}；默认沿用当前会话`),
      modelId: z.string().nullable().optional().describe(`${FIELD_DESCRIPTIONS.modelId}；默认 null`),
      projectId: z.string().nullable().optional().describe(`${FIELD_DESCRIPTIONS.projectId}；默认沿用当前会话的项目`),
      skills: z.array(z.string()).optional().describe(FIELD_DESCRIPTIONS.skills),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (args) => {
    const built = buildScheduleFromInput(args.schedule);
    if (!built.schedule) return errorResult(built.error || "触发配置无效");
    const provider = args.provider?.trim() || context.provider;
    const resolvedSkills = resolveSkills(provider, args.skills || []);
    if (!resolvedSkills.skills) return errorResult(resolvedSkills.error || "技能无效");
    const input: AutomationInput = {
      name: args.name.trim(),
      prompt: args.prompt.trim(),
      enabled: true,
      provider,
      modelId: args.modelId?.trim() || null,
      projectId: args.projectId === undefined ? context.projectId : args.projectId?.trim() || null,
      channelType: args.delivery?.trim() || resolveDefaultDelivery(context),
      skills: resolvedSkills.skills,
      schedule: built.schedule,
    };
    const validationError = validateAgentAutomation(input);
    if (validationError) return errorResult(validationError);
    try {
      const automation = createAutomation(input);
      logger.info("agent_mcp.automation.created", { id: automation.id, sessionId: context.sessionId });
      return jsonResult({
        message: "自动化已创建并启用。请向用户确认任务名称、触发方式、下次执行时间和交付方式，并告知可在自动化页面查看或修改。",
        automation: summarizeAutomation(automation),
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "创建自动化失败");
    }
  });

  server.registerTool("automation_update", {
    title: "修改自动化",
    description: "修改已有自动化，只需传要修改的字段，未传的字段保持不变；也可以通过 enabled 启用或停用。修改前用 automation_list 获取 ID。",
    inputSchema: {
      id: z.string().describe("要修改的自动化 ID"),
      name: z.string().optional().describe(FIELD_DESCRIPTIONS.name),
      prompt: z.string().optional().describe(FIELD_DESCRIPTIONS.prompt),
      schedule: scheduleInputSchema.optional().describe("新的触发配置，需完整填写"),
      enabled: z.boolean().optional().describe("true 启用，false 停用"),
      delivery: z.string().optional().describe(FIELD_DESCRIPTIONS.delivery),
      provider: z.string().optional().describe(FIELD_DESCRIPTIONS.provider),
      modelId: z.string().nullable().optional().describe(FIELD_DESCRIPTIONS.modelId),
      projectId: z.string().nullable().optional().describe(FIELD_DESCRIPTIONS.projectId),
      skills: z.array(z.string()).optional().describe(`${FIELD_DESCRIPTIONS.skills}；传空数组表示清空`),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    const existing = getAutomation(args.id);
    if (!existing) return errorResult(`自动化 ${args.id} 不存在，请先用 automation_list 查询`);

    let schedule = existing.schedule;
    if (args.schedule) {
      const built = buildScheduleFromInput(args.schedule);
      if (!built.schedule) return errorResult(built.error || "触发配置无效");
      schedule = built.schedule;
    }
    const provider = args.provider?.trim() || existing.provider;
    const providerChanged = provider !== existing.provider;
    let skills = existing.skills;
    if (args.skills) {
      const resolved = resolveSkills(provider, args.skills);
      if (!resolved.skills) return errorResult(resolved.error || "技能无效");
      skills = resolved.skills;
    } else if (providerChanged) {
      // 技能按 Provider 隔离，切换 Provider 且未指定技能时只保留新 Provider 下仍存在的技能
      const available = new Set(listSkillMentions(provider).filter((skill) => skill.enabled).map((skill) => skill.id));
      skills = existing.skills.filter((skill) => available.has(skill.id));
    }
    let modelId = args.modelId === undefined ? existing.modelId : args.modelId?.trim() || null;
    // 切换 Provider 且未指定模型时，原模型通常不属于新 Provider，改为跟随默认模型
    if (providerChanged && args.modelId === undefined) modelId = null;

    const input: AutomationInput = {
      name: args.name?.trim() || existing.name,
      prompt: args.prompt?.trim() || existing.prompt,
      enabled: args.enabled ?? existing.enabled,
      provider,
      modelId,
      projectId: args.projectId === undefined ? existing.projectId : args.projectId?.trim() || null,
      channelType: args.delivery?.trim() || existing.channelType,
      skills,
      schedule,
    };
    const validationError = validateAgentAutomation(input);
    if (validationError) return errorResult(validationError);
    try {
      const automation = updateAutomation(existing.id, input);
      if (!automation) return errorResult(`自动化 ${args.id} 不存在`);
      logger.info("agent_mcp.automation.updated", { id: automation.id, sessionId: context.sessionId });
      return jsonResult({ message: "自动化已更新", automation: summarizeAutomation(automation) });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "更新自动化失败");
    }
  });

  server.registerTool("automation_delete", {
    title: "删除自动化",
    description: "永久删除一个自动化。仅在用户明确要求删除时调用；只是暂停请用 automation_update 设置 enabled=false。",
    inputSchema: {
      id: z.string().describe("要删除的自动化 ID"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const existing = getAutomation(id);
    if (!existing) return errorResult(`自动化 ${id} 不存在，请先用 automation_list 查询`);
    try {
      if (!deleteAutomation(id)) return errorResult(`自动化 ${id} 不存在`);
      logger.info("agent_mcp.automation.deleted", { id, sessionId: context.sessionId });
      return jsonResult({ message: `已删除自动化「${existing.name}」`, id });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "删除自动化失败");
    }
  });

  return server;
}
