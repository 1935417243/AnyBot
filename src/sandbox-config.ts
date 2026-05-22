import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxModes, type SandboxMode } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.resolve(__dirname, "../.data");
const CONFIG_PATH = path.join(dataDir, "runtime-config.json");
export const DEFAULT_SANDBOX: SandboxMode = "workspace-write";

export type SandboxConfig = {
  defaultSandbox: SandboxMode;
};

export const sandboxModeOptions: Array<{
  id: SandboxMode;
  name: string;
  description: string;
}> = [
  {
    id: "read-only",
    name: "只读",
    description: "只能读取文件，适合查看和问答",
  },
  {
    id: "workspace-write",
    name: "工作区可写",
    description: "允许修改当前工作区文件，推荐日常开发使用",
  },
  {
    id: "danger-full-access",
    name: "完全访问",
    description: "允许访问和修改更多本机文件，仅在信任任务时使用",
  },
];

function validateSandboxMode(value: unknown): SandboxMode | null {
  return sandboxModes.includes(value as SandboxMode) ? value as SandboxMode : null;
}

function getInitialSandbox(): SandboxMode {
  if (!process.env.CODEX_SANDBOX) return DEFAULT_SANDBOX;
  const sandbox = validateSandboxMode(process.env.CODEX_SANDBOX);
  if (!sandbox) {
    throw new Error(
      `CODEX_SANDBOX 配置无效：${process.env.CODEX_SANDBOX}。可选值只有：${sandboxModes.join("、")}`,
    );
  }
  return sandbox;
}

function ensureConfig(): void {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ defaultSandbox: getInitialSandbox() } satisfies SandboxConfig, null, 2),
      "utf-8",
    );
  }
}

export function readSandboxConfig(): SandboxConfig {
  ensureConfig();
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw) as Partial<SandboxConfig>;
  const defaultSandbox = validateSandboxMode(config.defaultSandbox) || getInitialSandbox();
  if (config.defaultSandbox !== defaultSandbox) {
    writeFileSync(CONFIG_PATH, JSON.stringify({ defaultSandbox } satisfies SandboxConfig, null, 2), "utf-8");
  }
  return { defaultSandbox };
}

export function getDefaultSandbox(): SandboxMode {
  return readSandboxConfig().defaultSandbox;
}

export function setDefaultSandbox(defaultSandbox: string): SandboxConfig {
  const sandbox = validateSandboxMode(defaultSandbox);
  if (!sandbox) {
    throw new Error(`不支持的权限模式: ${defaultSandbox}`);
  }
  const config = { defaultSandbox: sandbox } satisfies SandboxConfig;
  ensureConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}
