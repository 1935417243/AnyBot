import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORE_PROMPT_FILE_ORDER = [
  "AGENTS.md",
  "PROFILE.md",
  "SOUL.md",
] as const;

const OPTIONAL_PROMPT_FILE_ORDER = ["MEMORY.md"] as const;

const RUNTIME_PROMPT_FILE_ORDER = [
  ...CORE_PROMPT_FILE_ORDER,
  ...OPTIONAL_PROMPT_FILE_ORDER,
] as const;

const TEMPLATE_FILE_ORDER = [
  ...RUNTIME_PROMPT_FILE_ORDER,
  "BOOTSTRAP.md",
] as const;

const DEFAULT_PROMPT_DIR = fileURLToPath(
  new URL("./agents/md_files/zh", import.meta.url),
);

function stripFrontmatter(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return trimmed;
  }

  const parts = trimmed.split("---");
  if (parts.length < 3) {
    return trimmed;
  }

  return parts.slice(2).join("---").trim();
}

function resolvePromptDir(promptDir?: string): string {
  if (!promptDir?.trim()) {
    return DEFAULT_PROMPT_DIR;
  }

  return path.resolve(promptDir);
}

function readMarkdownFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const rawContent = readFileSync(filePath, "utf8");
  const content = stripFrontmatter(rawContent);
  return content || null;
}

function ensureWorkspacePromptFiles(
  workdir: string,
  templateDir: string,
): void {
  mkdirSync(workdir, { recursive: true });

  for (const filename of TEMPLATE_FILE_ORDER) {
    const sourcePath = path.join(templateDir, filename);
    const targetPath = path.join(workdir, filename);

    if (!existsSync(sourcePath) || existsSync(targetPath)) {
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
}

function shouldIncludeMemory(conversationText?: string): boolean {
  const normalized = conversationText?.trim();
  if (!normalized) {
    return false;
  }

  if (
    normalized.length <= 12 &&
    /^(你好|您好|在吗|hi|hello|hey|ok|okay|收到|好的|嗯|哈喽)$/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return /(```|`[^`]+`|\/|\\|\.([cm]?[jt]sx?|py|md|json|yaml|yml|env)\b|npm\b|node\b|git\b|bash\b|shell\b|代码|仓库|项目|文件|目录|路径|环境变量|命令|日志|报错|错误|测试|调试|实现|重构|优化|提示词|上下文|记忆|飞书|机器人|Codex|prompt|memory|profile|agent|sandbox)/i.test(
    normalized,
  );
}

function loadPromptSections(
  workdir: string,
  conversationText?: string,
): string[] {
  const sections: string[] = [];

  for (const filename of CORE_PROMPT_FILE_ORDER) {
    const filePath = path.join(workdir, filename);
    const content = readMarkdownFile(filePath);
    if (!content) {
      continue;
    }

    sections.push(`# ${filename}\n\n${content}`);
  }

  if (shouldIncludeMemory(conversationText)) {
    for (const filename of OPTIONAL_PROMPT_FILE_ORDER) {
      const filePath = path.join(workdir, filename);
      const content = readMarkdownFile(filePath);
      if (!content) {
        continue;
      }

      sections.push(`# ${filename}\n\n${content}`);
    }
  }

  return sections;
}

function buildBootstrapBlock(workdir: string, sandbox: string): string | null {
  const bootstrapPath = path.join(workdir, "BOOTSTRAP.md");
  const bootstrapContent = readMarkdownFile(bootstrapPath);
  if (!bootstrapContent) {
    return null;
  }

  const persistenceHint =
    sandbox === "read-only"
      ? "当前 sandbox 是 read-only，所以你不能真正写回文件。需要明确告诉用户：你可以先完成引导，但只有在可写权限下才能持久保存到 PROFILE.md / MEMORY.md。"
      : "当前 sandbox 允许写入。引导过程中一旦拿到稳定信息，就直接更新工作目录中的 PROFILE.md / MEMORY.md，避免只记在聊天上下文里。";

  return [
    "# BOOTSTRAP MODE",
    "",
    "工作目录里存在 `BOOTSTRAP.md`，说明当前仍处于首次引导阶段。",
    "当用户第一次打招呼、闲聊或只发一句很短的话时，不要只回通用客服式寒暄。",
    "你应该简短地自我介绍，然后自然地推进 1 到 2 个引导问题，例如用户名字、希望怎么称呼、偏好的语言和协作方式。",
    "如果用户这轮明确要直接处理任务，也可以先帮他做事，但要保持温和，并在合适时机继续完成引导。",
    persistenceHint,
    "当你已经收集到足够的长期信息并写回文件后，删除工作目录里的 `BOOTSTRAP.md`，表示引导完成。",
    "",
    "# BOOTSTRAP.md",
    "",
    bootstrapContent,
  ].join("\n");
}

export function buildSystemPrompt(options: {
  workdir: string;
  sandbox: string;
  extraPrompt?: string;
  templateDir?: string;
  conversationText?: string;
}): string {
  const templateDir = resolvePromptDir(options.templateDir);
  ensureWorkspacePromptFiles(options.workdir, templateDir);

  const parts = [
    [
      "你是在飞书里回复用户的本机 Codex 代理。",
      "默认简洁、直接、可信，语气自然一点，像真人同事，不像机器人播报。",
      "不要装作看到了你没有实际确认的东西。",
      `当前工作目录：${options.workdir}`,
      `当前 sandbox：${options.sandbox}`,
    ].join("\n"),
  ];

  if (options.extraPrompt?.trim()) {
    parts.push(options.extraPrompt.trim());
  }

  const sections = loadPromptSections(
    options.workdir,
    options.conversationText,
  );
  if (sections.length > 0) {
    parts.push(sections.join("\n\n"));
  }

  const bootstrapBlock = buildBootstrapBlock(
    options.workdir,
    options.sandbox,
  );
  if (bootstrapBlock) {
    parts.push(bootstrapBlock);
  }

  return parts.join("\n\n");
}
