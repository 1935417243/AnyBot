import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../../logger.js";
import { generateId, getWorkdir } from "../../shared.js";
import * as db from "../db.js";
import { emitProjectsChanged } from "../events.js";

const execFile = promisify(execFileCallback);
const WORKSPACE_MEMORY_FILES = ["AGENTS.md", "MEMORY.md", "PROFILE.md", "BOOTSTRAP.md"] as const;

export function normalizeProjectPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("缺少项目路径");
  }
  const resolved = fs.realpathSync(path.resolve(inputPath));
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error("项目路径必须是文件夹");
  }
  return resolved;
}

export function migrateWorkspaceMemoryFiles(sourceDir: string, targetDir: string): string[] {
  const from = path.resolve(sourceDir);
  const to = path.resolve(targetDir);
  if (from === to) return [];

  const copied: string[] = [];
  for (const file of WORKSPACE_MEMORY_FILES) {
    const source = path.join(from, file);
    const target = path.join(to, file);
    try {
      if (!fs.existsSync(source) || fs.existsSync(target)) continue;
      fs.copyFileSync(source, target);
      copied.push(file);
    } catch (error) {
      logger.warn("workspace.memory_migration_file_failed", { file, source, target, error });
    }
  }
  return copied;
}

export function createOrTouchProject(projectPath: string): db.Project {
  const normalizedPath = normalizeProjectPath(projectPath);
  const existing = db.findProjectByPath(normalizedPath);
  if (existing) {
    const updatedAt = Date.now();
    db.touchProject(existing.id, updatedAt);
    emitProjectsChanged(existing.id, "project_touched");
    return { ...existing, updatedAt };
  }
  const now = Date.now();
  const project: db.Project = {
    id: generateId(),
    name: path.basename(normalizedPath) || normalizedPath,
    path: normalizedPath,
    createdAt: now,
    updatedAt: now,
  };
  db.createProject(project);
  emitProjectsChanged(project.id, "project_created");
  return project;
}

function isFolderPickerCanceled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; stderr?: unknown };
  const text = `${String(candidate.message || "")}\n${String(candidate.stderr || "")}`;
  return candidate.code === 2 || text.includes("(-128)") || text.includes("用户已取消") || text.includes("User canceled") || text.includes("User cancelled");
}

function resolveFolderPickerDefaultPath(defaultPath?: string): string | null {
  if (!defaultPath) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(defaultPath));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteAppleScriptString(value: string): string {
  return JSON.stringify(value);
}

export async function pickProjectFolder(opts: { defaultPath?: string; prompt?: string } = {}): Promise<string | null> {
  let stdout = "";
  const prompt = opts.prompt || "选择项目文件夹";
  const defaultPath = resolveFolderPickerDefaultPath(opts.defaultPath);

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = ${quotePowerShellString(prompt)}`,
      "$dialog.ShowNewFolderButton = $true",
      ...(defaultPath ? [`$dialog.SelectedPath = ${quotePowerShellString(defaultPath)}`] : []),
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.WriteLine($dialog.SelectedPath)",
      "  exit 0",
      "}",
      "exit 2",
    ].join("\n");
    try {
      const result = await execFile("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ]);
      stdout = result.stdout;
    } catch (error) {
      if (isFolderPickerCanceled(error)) {
        return null;
      }
      throw error;
    }
    return stdout.trim();
  }

  if (process.platform !== "darwin") {
    throw new Error("当前系统暂不支持从浏览器唤起本地文件夹选择器");
  }

  try {
    const script = defaultPath
      ? `POSIX path of (choose folder with prompt ${quoteAppleScriptString(prompt)} default location POSIX file ${quoteAppleScriptString(defaultPath)})`
      : `POSIX path of (choose folder with prompt ${quoteAppleScriptString(prompt)})`;
    const result = await execFile("osascript", [
      "-e",
      script,
    ]);
    stdout = result.stdout;
  } catch (error) {
    if (isFolderPickerCanceled(error)) {
      return null;
    }
    throw error;
  }
  return stdout.trim();
}

function ensurePathInsideProject(projectPath: string, relativePath: string): string {
  const root = normalizeProjectPath(projectPath);
  const target = path.resolve(root, relativePath || ".");
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("目录路径越界");
  }
  return target;
}

export function readProjectTree(project: db.Project, relativePath: string): Array<{
  name: string;
  path: string;
  type: "directory" | "file";
}> {
  const target = ensurePathInsideProject(project.path, relativePath);
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    throw new Error("目标路径不是文件夹");
  }

  return fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .slice(0, 200)
    .map((entry) => ({
      name: entry.name,
      path: path.relative(project.path, path.join(target, entry.name)),
      type: entry.isDirectory() ? "directory" as const : "file" as const,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function getSessionWorkdir(session: Pick<db.ChatSession, "projectId">): string {
  if (!session.projectId) return getWorkdir();
  const project = db.getProject(session.projectId);
  if (!project) {
    throw new Error("项目不存在");
  }
  return normalizeProjectPath(project.path);
}
