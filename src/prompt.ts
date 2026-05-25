import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE_CONTEXT_FILES = ["AGENTS.md", "MEMORY.md", "PROFILE.md"] as const;
const MAX_WORKSPACE_CONTEXT_FILE_CHARS = 80_000;

function readWorkspaceContextFile(workdir: string, filename: string): string | null {
  const file = join(workdir, filename);
  if (!existsSync(file)) return null;
  try {
    const content = readFileSync(file, "utf8").trim();
    if (!content) return null;
    if (content.length <= MAX_WORKSPACE_CONTEXT_FILE_CHARS) return content;
    return [
      content.slice(0, MAX_WORKSPACE_CONTEXT_FILE_CHARS),
      "",
      `[已截断：${filename} 超过 ${MAX_WORKSPACE_CONTEXT_FILE_CHARS} 字符。如需完整内容，请按需读取该文件。]`,
    ].join("\n");
  } catch {
    return null;
  }
}

function buildWorkspaceContext(workdir: string): string | null {
  const sections = WORKSPACE_CONTEXT_FILES.flatMap((filename) => {
    const content = readWorkspaceContextFile(workdir, filename);
    if (!content) return [];
    return [`### ${filename}\n\n${content}`];
  });

  if (sections.length === 0) return null;

  return [
    "## 工作区启动上下文",
    "",
    "下面是程序在本次新会话开始前已直接读取的工作目录文件内容。你必须视为已经完成启动读取步骤，遵循其中规则和记忆；不要为了首轮启动再次调用工具读取这些文件。只有在需要确认磁盘最新内容、修改记忆或用户明确要求时，才访问这些文件。",
    "",
    ...sections,
  ].join("\n");
}

export function buildSystemPrompt(options: {
  workdir: string;
  sandbox: string;
  extraPrompt?: string;
  isFirstTurn?: boolean;
  includeWorkspaceMemory?: boolean;
}): string {
  const platform = process.platform;
  const env = `[环境] 工作目录=${options.workdir} sandbox=${options.sandbox} os=${platform}`;
  const includeWorkspaceMemory = options.includeWorkspaceMemory !== false;

  const launchRule = [
    "启动应用程序时必须确保应用独立于当前进程运行，不会因为当前命令结束而关闭：",
    platform === "darwin"
      ? '- macOS：使用 `open -a "应用名"` 命令'
      : '- Linux：使用 `setsid <command> &>/dev/null &` 或 `nohup <command> &>/dev/null &`',
    "- 禁止直接执行应用二进制文件（除非已用上述方式包裹）",
  ].join("\n");

  if (options.isFirstTurn !== false && includeWorkspaceMemory) {
    const workspaceContext = buildWorkspaceContext(options.workdir);
    if (workspaceContext) {
      const parts = [env, launchRule, workspaceContext];
      if (options.extraPrompt?.trim()) parts.push(options.extraPrompt.trim());
      return parts.join("\n\n");
    }
  }

  const parts = [env, launchRule];

  if (options.isFirstTurn !== false && includeWorkspaceMemory) {
    parts.push(
      [
        "工作目录下未找到 AGENTS.md、MEMORY.md 或 PROFILE.md。",
        "这是新会话的第一条消息，后续消息不会重复此提示。只有在用户明确要求或需要写入记忆时，才按需访问这些文件。",
      ].join("\n"),
    );
  }

  if (options.extraPrompt?.trim()) {
    parts.push(options.extraPrompt.trim());
  }

  return parts.join("\n\n");
}
