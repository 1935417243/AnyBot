import type { ChannelCallbacks } from "./types.js";

export interface CommandResult {
  handled: boolean;
  reply?: string;
}

export function handleCommand(
  userText: string,
  chatId: string,
  source: string,
  callbacks: ChannelCallbacks,
): CommandResult {
  const parsed = parseCommand(userText);
  if (!parsed) {
    return { handled: false };
  }
  const style = getReplyStyle(source);

  if (parsed.name === "new" || parsed.name === "reset" || parsed.name === "start") {
    callbacks.resetSession(chatId, source);
    return { handled: true, reply: "新窗口已开启，我们可以继续聊天了" };
  }

  if (parsed.name === "help") {
    return { handled: true, reply: formatHelp(style) };
  }

  if (parsed.name === "provider" && !parsed.argument) {
    return { handled: true, reply: formatProviderList(callbacks, style) };
  }

  if (parsed.name === "provider") {
    const target = resolveProviderTarget(parsed.argument, callbacks);
    if (!target) {
      return { handled: true, reply: formatProviderList(callbacks, style, parsed.argument) };
    }
    const result = callbacks.switchProvider(target);
    return { handled: true, reply: result.message };
  }

  if (parsed.name === "model" && !parsed.argument) {
    return { handled: true, reply: formatModelList(callbacks, style) };
  }

  if (parsed.name === "model") {
    const target = resolveModelTarget(parsed.argument, callbacks);
    if (!target) {
      return { handled: true, reply: formatModelList(callbacks, style, parsed.argument) };
    }
    const result = callbacks.switchModel(target);
    return { handled: true, reply: result.message };
  }

  if (parsed.name === "workspace" && !parsed.argument) {
    return { handled: true, reply: formatWorkspaceList(callbacks, style, chatId, source) };
  }

  if (parsed.name === "workspace") {
    const target = resolveWorkspaceTarget(parsed.argument, callbacks, chatId, source);
    if (target === undefined) {
      return {
        handled: true,
        reply: formatWorkspaceList(callbacks, style, chatId, source, parsed.argument),
      };
    }
    const result = callbacks.switchWorkspace(chatId, source, target);
    return { handled: true, reply: result.message };
  }

  return { handled: false };
}

interface ParsedCommand {
  name: "new" | "reset" | "start" | "help" | "provider" | "model" | "workspace";
  argument: string;
}

type ReplyStyle = "plain" | "markdown";

function getReplyStyle(source: string): ReplyStyle {
  return source === "weixin" || source === "qqbot" ? "markdown" : "plain";
}

function parseCommand(userText: string): ParsedCommand | null {
  const trimmed = userText.trim();
  if (!trimmed) {
    return null;
  }

  const hasSlash = trimmed.startsWith("/");
  const commandText = hasSlash ? trimmed.slice(1).trim() : trimmed;
  const match = commandText.match(/^([a-zA-Z]+)(?:\s+(.+))?$/);
  if (!match) {
    return null;
  }

  const name = match[1].toLowerCase();
  const argument = (match[2] ?? "").trim();

  if (name === "provider" || name === "model" || name === "workspace") {
    if (!hasSlash && argument && parseSelectionIndex(argument) === null) {
      return null;
    }
    return { name, argument };
  }

  if (hasSlash && (name === "new" || name === "reset" || name === "start" || name === "help")) {
    return { name, argument };
  }

  return null;
}

function formatHelp(style: ReplyStyle): string {
  if (style === "markdown") {
    return [
      "📋 **可用命令**",
      "",
      "- `/new`：开启新窗口",
      "- `/provider`：查看供应商列表",
      "- `/model`：查看模型列表",
      "- `/workspace`：查看工作区列表",
      "- `/help`：显示此帮助",
    ].join("\n");
  }

  return [
    "📋 可用命令：",
    "",
    "/new — 开启新窗口",
    "/provider — 查看供应商列表",
    "/model — 查看模型列表",
    "/workspace — 查看工作区列表",
    "/help — 显示此帮助",
  ].join("\n");
}

function formatProviderList(
  callbacks: ChannelCallbacks,
  style: ReplyStyle,
  invalidSelection?: string,
): string {
  const providers = callbacks.listProviders();
  const lines = [style === "markdown" ? "🔧 **可用供应商**" : "🔧 可用供应商："];
  for (const [index, p] of providers.entries()) {
    const marker = p.isCurrent ? " ✅" : "";
    if (style === "markdown") {
      lines.push(`${index + 1}. \`${p.type}\`${marker}`);
    } else {
      lines.push(`${index + 1}. ${p.type}${marker}`);
    }
  }
  if (invalidSelection) {
    lines.push("", style === "markdown"
      ? `未找到供应商序号：\`${invalidSelection}\``
      : `未找到供应商序号：${invalidSelection}`);
  }
  lines.push("", style === "markdown"
    ? "切换：`provider 1`"
    : "切换：provider 1");
  return lines.join("\n");
}

function formatModelList(
  callbacks: ChannelCallbacks,
  style: ReplyStyle,
  invalidSelection?: string,
): string {
  const models = callbacks.listModels();
  if (models.length === 0) {
    return "当前供应商没有可用模型。";
  }
  const lines = [style === "markdown" ? "🤖 **可用模型**" : "🤖 可用模型："];
  for (const [index, m] of models.entries()) {
    const marker = m.isCurrent ? " ✅" : "";
    // 与 Web 端模型下拉一致：优先展示映射后的名字（如 k3-256k），无映射时回退到原始 id
    const label = m.name || m.id;
    if (style === "markdown") {
      lines.push(`${index + 1}. \`${label}\`${marker}`);
    } else {
      lines.push(`${index + 1}. ${label}${marker}`);
    }
  }
  if (invalidSelection) {
    lines.push("", style === "markdown"
      ? `未找到模型序号：\`${invalidSelection}\``
      : `未找到模型序号：${invalidSelection}`);
  }
  lines.push("", style === "markdown"
    ? "切换：`model 1`"
    : "切换：model 1");
  return lines.join("\n");
}

function formatWorkspaceList(
  callbacks: ChannelCallbacks,
  style: ReplyStyle,
  chatId: string,
  source: string,
  invalidSelection?: string,
): string {
  const workspaces = callbacks.listWorkspaces(chatId, source);
  const lines = [style === "markdown" ? "🗂️ **可用工作区**" : "🗂️ 可用工作区："];
  for (const [index, workspace] of workspaces.entries()) {
    const marker = workspace.isCurrent ? " ✅" : "";
    if (style === "markdown") {
      lines.push(`${index + 1}. \`${workspace.name}\`${marker}`);
    } else {
      lines.push(`${index + 1}. ${workspace.name}${marker}`);
    }
  }
  if (invalidSelection) {
    lines.push("", style === "markdown"
      ? `未找到工作区序号：\`${invalidSelection}\``
      : `未找到工作区序号：${invalidSelection}`);
  }
  lines.push("", style === "markdown"
    ? "切换：`workspace 1`"
    : "切换：workspace 1");
  return lines.join("\n");
}

function resolveProviderTarget(argument: string, callbacks: ChannelCallbacks): string | null {
  const index = parseSelectionIndex(argument);
  if (index === null) {
    return argument || null;
  }
  if (index < 1) {
    return null;
  }
  return callbacks.listProviders()[index - 1]?.type ?? null;
}

function resolveModelTarget(argument: string, callbacks: ChannelCallbacks): string | null {
  const index = parseSelectionIndex(argument);
  if (index === null) {
    return argument || null;
  }
  if (index < 1) {
    return null;
  }
  return callbacks.listModels()[index - 1]?.id ?? null;
}

function resolveWorkspaceTarget(
  argument: string,
  callbacks: ChannelCallbacks,
  chatId: string,
  source: string,
): string | null | undefined {
  const index = parseSelectionIndex(argument);
  if (index === null || index < 1) {
    return undefined;
  }
  return callbacks.listWorkspaces(chatId, source)[index - 1]?.id;
}

function parseSelectionIndex(argument: string): number | null {
  if (!/^\d+$/.test(argument)) {
    return null;
  }
  return Number.parseInt(argument, 10);
}
