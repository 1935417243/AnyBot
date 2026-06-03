import type { SandboxMode } from "./types.js";
import { getDefaultSandbox } from "./sandbox-config.js";
import { buildSystemPrompt } from "./prompt.js";
import { readAppSettings } from "./app-settings.js";

const extraSystemPrompt = process.env.CODEX_SYSTEM_PROMPT;

const CHANNEL_OUTPUT_RULES: Record<string, string[]> = {
  weixin: [
    "微信渠道支持附件回传：只有用户明确要求发送/回传附件，或本轮确实生成了需要交付的图片/文件时，才输出附件指令。",
    "如果需要把图片/截图发给用户，必须每张图片单独一行输出：IMAGE: /绝对路径/文件名.png。相对路径基于工作目录解析。",
    "如果需要把非图片文件发给用户，必须每个文件单独一行输出：FILE: /绝对路径/文件名.扩展名。",
    "如果用户只是询问有哪些文件、文件路径、目录结构或让你列清单，只用文字列出，不要输出 IMAGE: 或 FILE:。",
    "不要对不存在、未确认、敏感或只是顺带提到的路径输出 IMAGE: 或 FILE:。",
  ],
  feishu: [
    "飞书渠道支持附件回传：只有用户明确要求发送/回传附件，或本轮确实生成了需要交付的图片/文件时，才输出附件指令。",
    "如果需要把图片/截图发给用户，必须每张图片单独一行输出：IMAGE: /绝对路径/文件名.png。相对路径基于工作目录解析。",
    "如果需要把非图片文件发给用户，必须每个文件单独一行输出：FILE: /绝对路径/文件名.扩展名。",
    "如果用户只是询问有哪些文件、文件路径、目录结构或让你列清单，只用文字列出，不要输出 IMAGE: 或 FILE:。",
    "不要对不存在、未确认、敏感或只是顺带提到的路径输出 IMAGE: 或 FILE:。",
  ],
  dingtalk: [
    "钉钉渠道支持 Markdown 和附件回传：只有用户明确要求发送/回传附件，或本轮确实生成了需要交付的图片/文件时，才输出附件指令。",
    "如果需要把图片/截图发给用户，必须每张图片单独一行输出：IMAGE: /绝对路径/文件名.png。相对路径基于工作目录解析。",
    "如果需要把非图片文件发给用户，必须每个文件单独一行输出：FILE: /绝对路径/文件名.扩展名。",
    "如果用户只是询问有哪些文件、文件路径、目录结构或让你列清单，只用文字列出，不要输出 IMAGE: 或 FILE:。",
    "不要对不存在、未确认、敏感或只是顺带提到的路径输出 IMAGE: 或 FILE:。",
  ],
  telegram: [
    "Telegram 渠道当前不支持附件回传；如果生成了文件，请给出文件的本机绝对路径。",
  ],
  qqbot: [
    "QQ 渠道支持 Markdown 文本回复，请优先用 Markdown 组织标题、列表和代码块。",
    "QQ 渠道支持图片回传：只有用户明确要求发送/回传图片，或本轮确实生成了需要交付的图片/截图时，才输出图片指令。",
    "如果需要把图片/截图发给用户，必须每张图片单独一行输出：IMAGE: /绝对路径/文件名.png。相对路径基于工作目录解析。",
    "如果用户只是询问有哪些文件、文件路径、目录结构或让你列清单，只用文字列出，不要输出 IMAGE:。",
    "QQ 渠道当前未放开非图片文件发送；如果生成了非图片文件，请给出文件的本机绝对路径，不要输出 FILE:。",
  ],
};

function getSystemPrompt(opts?: {
  workdir?: string;
  sandbox?: SandboxMode;
  includeWorkspaceMemory?: boolean;
}): string {
  const workdir = getWorkdir();
  return buildSystemPrompt({
    workdir: opts?.workdir || workdir,
    sandbox: opts?.sandbox || getDefaultSandbox(),
    extraPrompt: extraSystemPrompt,
    includeWorkspaceMemory: opts?.includeWorkspaceMemory,
  });
}

function buildOutputContract(source: string): string {
  const base = [
    `当前消息来自：${source}客户端`,
    "只回复当前这条用户消息。",
  ];
  return [...base, ...(CHANNEL_OUTPUT_RULES[source] || [])].join("\n");
}

export function buildFirstTurnPrompt(
  userText: string,
  source: string = "web",
  opts?: {
    workdir?: string;
    sandbox?: SandboxMode;
    includeWorkspaceMemory?: boolean;
  },
): string {
  return `${getSystemPrompt(opts)}

输出要求：
${buildOutputContract(source)}

用户消息：
${userText}`;
}

export function buildResumePrompt(userText: string, source: string = "web"): string {
  return `${userText}

补充要求：
${buildOutputContract(source)}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateTitle(text: string): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > 20 ? clean.slice(0, 20) + "…" : clean;
}

export function getWorkdir(): string {
  return process.env.CODEX_WORKDIR || readAppSettings().workspace.defaultWorkdir || process.cwd();
}

export function getSandbox(): SandboxMode {
  return getDefaultSandbox();
}
