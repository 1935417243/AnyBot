import type { SandboxMode } from "./types.js";
import { sandboxModes } from "./types.js";
import { buildSystemPrompt } from "./prompt.js";

const sandboxRaw = process.env.CODEX_SANDBOX || "read-only";
const workdir = process.env.CODEX_WORKDIR || process.cwd();
const extraSystemPrompt = process.env.CODEX_SYSTEM_PROMPT;

if (!sandboxModes.includes(sandboxRaw as SandboxMode)) {
  throw new Error(
    `CODEX_SANDBOX 配置无效：${sandboxRaw}。可选值只有：${sandboxModes.join("、")}`,
  );
}

const sandbox = sandboxRaw as SandboxMode;

function getSystemPrompt(): string {
  return buildSystemPrompt({
    workdir,
    sandbox,
    extraPrompt: extraSystemPrompt,
  });
}

export const outputContract = [
  "只回复当前这条用户消息。",
  "如果需要发送图片给用户，在回复中包含图片绝对路径或 Markdown 图片语法 ![描述](/绝对路径.png)。相对路径基于工作目录解析。",
  "如果需要发送非图片文件，每个文件单独一行，格式：FILE: /绝对路径/文件名.扩展名。",
].join("\n");

export function buildFirstTurnPrompt(userText: string): string {
  return `${getSystemPrompt()}

输出要求：
${outputContract}

用户消息：
${userText}`;
}

export function buildResumePrompt(userText: string): string {
  return `${userText}

补充要求：
${outputContract}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateTitle(text: string): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > 20 ? clean.slice(0, 20) + "…" : clean;
}

export function getWorkdir(): string {
  return workdir;
}

export function getSandbox(): SandboxMode {
  return sandbox;
}
