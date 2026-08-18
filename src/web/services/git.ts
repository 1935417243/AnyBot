import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { getWorkdir } from "../../shared.js";
import * as db from "../db.js";
import { getSessionWorkdir, normalizeProjectPath } from "./projects.js";

const execFile = promisify(execFileCallback);
const GIT_TIMEOUT_MS = 5000;
const GIT_OUTPUT_LIMIT = 1024 * 1024;

export type GitBranchInfo = {
  isGitRepo: boolean;
  current?: string;
  branches?: string[];
};

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_OUTPUT_LIMIT,
  });
  return stdout;
}

function readGitError(error: unknown): string {
  const err = error as { stderr?: unknown; message?: unknown };
  const raw = typeof err?.stderr === "string" && err.stderr.trim()
    ? err.stderr.trim()
    : typeof err?.message === "string"
      ? err.message
      : "git 命令执行失败";
  return raw.split("\n")[0] || "git 命令执行失败";
}

export function resolveGitWorkdir(opts: { sessionId?: string; projectId?: string }): string {
  if (opts.sessionId) {
    const session = db.getSession(opts.sessionId);
    if (!session) throw new Error("会话不存在");
    return getSessionWorkdir(session);
  }
  if (opts.projectId) {
    const project = db.getProject(opts.projectId);
    if (!project) throw new Error("项目不存在");
    return normalizeProjectPath(project.path);
  }
  return getWorkdir();
}

export async function getGitBranchInfo(workdir: string): Promise<GitBranchInfo> {
  try {
    await runGit(["rev-parse", "--is-inside-work-tree"], workdir);
  } catch {
    return { isGitRepo: false };
  }

  let current = (await runGit(["branch", "--show-current"], workdir)).trim();
  if (!current) {
    current = (await runGit(["rev-parse", "--short", "HEAD"], workdir)).trim();
  }

  const listRaw = await runGit(["branch", "--format=%(refname:short)"], workdir);
  const branches = listRaw
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  return { isGitRepo: true, current, branches };
}

export async function checkoutGitBranch(workdir: string, branch: string): Promise<string> {
  const info = await getGitBranchInfo(workdir);
  if (!info.isGitRepo) throw new Error("当前目录不是 Git 仓库");
  if (!info.branches?.includes(branch)) throw new Error("分支不存在");
  try {
    await runGit(["checkout", branch], workdir);
  } catch (error) {
    throw new Error(readGitError(error));
  }
  return branch;
}
