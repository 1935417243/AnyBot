export function buildSystemPrompt(options: {
  workdir: string;
  sandbox: string;
  extraPrompt?: string;
}): string {
  const parts = [
    `[环境] 工作目录=${options.workdir} sandbox=${options.sandbox}`,
  ];

  if (options.extraPrompt?.trim()) {
    parts.push(options.extraPrompt.trim());
  }

  return parts.join("\n\n");
}
