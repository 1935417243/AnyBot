import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const isWindows = process.platform === "win32";

function isPathLike(command: string): boolean {
  return path.isAbsolute(command) || command.includes("/") || command.includes("\\");
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  if (!isWindows) return "PATH";
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
}

function getPathEnvValue(env: NodeJS.ProcessEnv): string {
  return env[getPathEnvKey(env)] || "";
}

function executableCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (!isWindows || path.extname(command)) return [command];

  const extensions = (env.PATHEXT || process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  // On Windows prefer PATHEXT variants first, because a bare extension-less file
  // (e.g. the Unix shell script `npx` shipped alongside `npx.cmd`) cannot be spawned
  // by Windows and would cause ENOENT even though the file exists.
  return [...extensions.map((ext) => `${command}${ext}`), command];
}

function canRun(filePath: string): boolean {
  try {
    accessSync(filePath, isWindows ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function canAccessDir(dir: string): boolean {
  try {
    accessSync(dir, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function splitPathEnv(value: string | undefined): string[] {
  return (value || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseVersionParts(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0);
}

function compareVersionNamesDesc(a: string, b: string): number {
  const aParts = parseVersionParts(a);
  const bParts = parseVersionParts(b);
  const length = Math.max(aParts.length, bParts.length, 3);
  for (let i = 0; i < length; i += 1) {
    const diff = (bParts[i] || 0) - (aParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function readVersionedNodeBins(parentDir: string, toBinDir: (name: string) => string): string[] {
  try {
    return readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionNamesDesc)
      .map(toBinDir);
  } catch {
    return [];
  }
}

function getExtraExecutablePathDirs(env: NodeJS.ProcessEnv): string[] {
  const home = os.homedir();
  const dirs: Array<string | undefined> = [];

  if (isWindows) {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    dirs.push(
      path.join(appData, "npm"),
      path.join(localAppData, "Programs", "nodejs"),
      path.join(localAppData, "Volta", "bin"),
      "C:\\Program Files\\nodejs",
      "C:\\Program Files (x86)\\nodejs",
    );
  } else {
    dirs.push(
      env.NVM_BIN,
      env.FNM_MULTISHELL_PATH,
      env.VOLTA_HOME ? path.join(env.VOLTA_HOME, "bin") : path.join(home, ".volta", "bin"),
      env.ASDF_DATA_DIR ? path.join(env.ASDF_DATA_DIR, "shims") : path.join(home, ".asdf", "shims"),
      env.MISE_DATA_DIR ? path.join(env.MISE_DATA_DIR, "shims") : path.join(home, ".local", "share", "mise", "shims"),
      path.join(home, ".local", "bin"),
    );

    const nvmDir = env.NVM_DIR || path.join(home, ".nvm");
    dirs.push(
      path.join(nvmDir, "current", "bin"),
      ...readVersionedNodeBins(path.join(nvmDir, "versions", "node"), (name) => path.join(nvmDir, "versions", "node", name, "bin")),
    );

    const fnmDir = env.FNM_DIR || path.join(home, ".local", "share", "fnm");
    dirs.push(
      ...readVersionedNodeBins(path.join(fnmDir, "node-versions"), (name) => path.join(fnmDir, "node-versions", name, "installation", "bin")),
    );

    if (process.platform === "darwin") {
      dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
    } else {
      dirs.push("/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
    }
  }

  return dirs.filter((dir): dir is string => !!dir && canAccessDir(dir));
}

export function buildExecutablePathEnv(env: NodeJS.ProcessEnv = process.env): string {
  return [
    ...splitPathEnv(getPathEnvValue(env)),
    ...getExtraExecutablePathDirs(env),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index).join(path.delimiter);
}

export function ensureExecutablePathEnv(env: NodeJS.ProcessEnv = process.env): void {
  const pathKey = getPathEnvKey(env);
  const value = buildExecutablePathEnv(env);
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path" && key !== pathKey) delete env[key];
  }
  env[pathKey] = value;
}

function withExecutablePathEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...(env || process.env) };
  ensureExecutablePathEnv(next);
  return next;
}

export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isPathLike(command)) {
    for (const candidate of executableCandidates(command, env)) {
      if (canRun(candidate)) return candidate;
    }
    return null;
  }

  const pathDirs = splitPathEnv(buildExecutablePathEnv(env));

  for (const dir of pathDirs) {
    for (const candidate of executableCandidates(path.join(dir, command), env)) {
      if (canRun(candidate)) return candidate;
    }
  }

  return null;
}

export function spawnCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  const env = withExecutablePathEnv(options.env);
  const resolvedCommand = resolveExecutable(command, env) || command;
  const extension = path.extname(resolvedCommand).toLowerCase();
  const needsShell = isWindows && (extension === ".cmd" || extension === ".bat");

  return spawn(resolvedCommand, args, {
    ...options,
    env,
    shell: needsShell,
    detached: isWindows ? false : options.detached,
  });
}

export function runCommandSync(
  command: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "shell"> = {},
): string {
  const env = withExecutablePathEnv(options.env);
  const resolvedCommand = resolveExecutable(command, env) || command;
  const extension = path.extname(resolvedCommand).toLowerCase();
  const needsShell = isWindows && (extension === ".cmd" || extension === ".bat");

  const result = spawnSync(resolvedCommand, args, {
    ...options,
    env,
    encoding: "utf8",
    shell: needsShell,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `${command} exited with ${result.status}`;
    throw new Error(message.trim());
  }

  return result.stdout;
}

export function killProcessTree(
  child: Pick<ChildProcessWithoutNullStreams, "pid" | "kill" | "killed">,
  signal: NodeJS.Signals,
): void {
  if (!child.pid) return;

  if (isWindows) {
    const forceArgs = signal === "SIGKILL" ? ["/F"] : [];
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", ...forceArgs], {
      stdio: "ignore",
    });
    if (result.status !== 0 && !child.killed) {
      child.kill(signal);
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
