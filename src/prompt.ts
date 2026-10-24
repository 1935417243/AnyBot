import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_CONTEXT_FILES = ["AGENTS.md", "MEMORY.md", "PROFILE.md"] as const;
const MAX_WORKSPACE_CONTEXT_FILE_CHARS = 80_000;
/** 内置工作区记忆模板目录（src/ 与 dist/ 下均为 agent/md_files） */
const WORKSPACE_TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "agent", "md_files");
/** 内容与内置模板一致（用户未填写）时跳过注入的文件 */
const SKIP_UNFILLED_TEMPLATE_FILES: ReadonlySet<string> = new Set(["MEMORY.md", "PROFILE.md"]);
/** 内置模板正文缓存，key 为文件名，null 表示模板不存在或读取失败 */
const templateBodyCache = new Map<string, string | null>();

/** 规范换行并去掉文件开头的 YAML frontmatter，只保留对模型有意义的正文 */
function normalizeContextContent(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "")
    .trim();
}

/** 读取内置模板正文（已去 frontmatter），用于判断工作区文件是否仍为未填写的模板 */
function readTemplateBody(filename: string): string | null {
  if (templateBodyCache.has(filename)) return templateBodyCache.get(filename) ?? null;
  let body: string | null = null;
  try {
    const file = join(WORKSPACE_TEMPLATE_DIR, filename);
    if (existsSync(file)) body = normalizeContextContent(readFileSync(file, "utf8"));
  } catch {
    body = null;
  }
  templateBodyCache.set(filename, body);
  return body;
}

function readWorkspaceContextFile(workdir: string, filename: string): string | null {
  const file = join(workdir, filename);
  if (!existsSync(file)) return null;
  try {
    const content = normalizeContextContent(readFileSync(file, "utf8"));
    if (!content) return null;
    if (SKIP_UNFILLED_TEMPLATE_FILES.has(filename) && content === readTemplateBody(filename)) return null;
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
    "以下工作目录文件已由程序读取，请遵循其中规则和记忆，无需再用工具读取；仅在修改记忆或用户要求时访问。",
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

  // 图示输出引导：与 WebUI 的 mermaid 渲染能力对齐，软引导不禁止用户指定其它格式
  const diagramRule = [
    "当用户请求流程图、时序图、架构图、甘特图、状态图等图示时，默认用 ```mermaid 代码块输出，除非用户明确指定其它格式（如 PlantUML、ASCII、HTML）。",
    "输出 mermaid 前自检语法（节点 id 合法、标签含特殊字符时用引号包裹、箭头语法正确），确保可直接渲染。",
  ].join("\n");

  const parts = [env, launchRule, diagramRule];

  if (options.isFirstTurn !== false && includeWorkspaceMemory) {
    const workspaceContext = buildWorkspaceContext(options.workdir);
    if (workspaceContext) parts.push(workspaceContext);
  }

  if (options.extraPrompt?.trim()) {
    parts.push(options.extraPrompt.trim());
  }

  return parts.join("\n\n");
}
