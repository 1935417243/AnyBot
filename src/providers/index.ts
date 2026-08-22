import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "module";
import type { IProvider } from "./types.js";
import { CodexProvider, resolveCodexExecutable } from "./codex.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { resolveExecutable } from "../utils/process.js";
import { getCliExecutablePath } from "../cli-runtime/installer.js";
import { getConfiguredWebPort, getCodexUpstreamFormat, getProviderRuntimeSettings } from "../app-settings.js";

const moduleRequire = createRequire(import.meta.url);

type ProviderFactory = (config?: Record<string, unknown>) => IProvider;

export interface ProviderInstallationStatus {
  installed: boolean;
  bin: string;
  executablePath: string | null;
  installHint: string;
}

function dropUndefined(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  );
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function preferSettingWhenEnabled(
  useSettingsFirst: boolean,
  settingValue: string | undefined,
  envValue: string | undefined,
): string | undefined {
  const setting = cleanString(settingValue);
  const env = cleanString(envValue);
  return useSettingsFirst ? setting || env : env || setting;
}

function getLocalCodexAdapterBaseUrl(): string {
  return `http://127.0.0.1:${getConfiguredWebPort()}/api/codex-openai/v1`;
}

function getClaudeCodeBin(): string | undefined {
  const bin = cleanString(process.env.CLAUDE_CODE_BIN);
  if (!bin || bin === "claude") return undefined;
  return bin;
}

function getClaudeCodeExecutable(
  settings: ReturnType<typeof getProviderRuntimeSettings>,
  useAnthropicCompat: boolean,
): string | undefined {
  const configured = cleanString(settings.pathToClaudeCodeExecutable) || cleanString(settings.bin);
  if (useAnthropicCompat) {
    return configured;
  }
  // 未显式指定时优先用按需下载到 userData 的 CLI；
  // 返回 undefined 则由 SDK 自行解析随包平台包（dev 环境下 node_modules 里有）
  return getClaudeCodeBin() || configured || getCliExecutablePath("claude-code") || undefined;
}

/** 随包的 Claude Code 平台包是否可用（生产包已裁剪平台包，仅 dev 环境为 true） */
function isBundledClaudeAvailable(): boolean {
  const names = [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`];
  if (process.platform === "linux") {
    names.push(`@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`);
  }
  for (const name of names) {
    try {
      moduleRequire.resolve(`${name}/package.json`);
      return true;
    } catch {
      // 平台包不存在，尝试下一个候选
    }
  }
  return false;
}

export function getProviderConfig(type: string): Record<string, unknown> {
  const settings = getProviderRuntimeSettings(normalizeProviderType(type));
  const useAnthropicCompat = settings.anthropicCompatEnabled === true;
  const anthropicAutoModel = preferSettingWhenEnabled(
    useAnthropicCompat,
    settings.anthropicAutoModel,
    process.env.ANTHROPIC_MODEL,
  );
  switch (normalizeProviderType(type)) {
    case "codex": {
      // anthropic 格式才需要本地适配层地址；responses 格式由 Codex 直连上游
      const codexUpstreamFormat = getCodexUpstreamFormat(settings);
      return dropUndefined({
        bin: process.env.CODEX_BIN || settings.bin,
        timeoutMs: settings.timeoutMs,
        codexCompatEnabled: settings.codexCompatEnabled,
        codexUpstreamFormat,
        codexAdapterBaseUrl:
          settings.codexCompatEnabled && codexUpstreamFormat === "anthropic"
            ? getLocalCodexAdapterBaseUrl()
            : undefined,
        codexAnthropicBaseUrl: settings.codexAnthropicBaseUrl,
        codexApiKey: settings.codexApiKey,
        codexDefaultModel: settings.codexDefaultModel,
        codexFastModel: settings.codexFastModel,
        codexCodeModel: settings.codexCodeModel,
      });
    }
    case "claude-code":
      return dropUndefined({
        pathToClaudeCodeExecutable: getClaudeCodeExecutable(settings, useAnthropicCompat),
        timeoutMs: settings.timeoutMs,
        defaultModel: useAnthropicCompat
          ? cleanString(settings.defaultModel) || anthropicAutoModel || cleanString(process.env.CLAUDE_AGENT_MODEL)
          : cleanString(process.env.CLAUDE_AGENT_MODEL),
        apiKey: preferSettingWhenEnabled(useAnthropicCompat, settings.apiKey, process.env.ANTHROPIC_API_KEY),
        apiKeyHelper: preferSettingWhenEnabled(useAnthropicCompat, settings.apiKeyHelper, process.env.CLAUDE_CODE_API_KEY_HELPER),
        anthropicBaseUrl: preferSettingWhenEnabled(useAnthropicCompat, settings.anthropicBaseUrl, process.env.ANTHROPIC_BASE_URL),
        anthropicAutoModel,
        anthropicOpusModel: preferSettingWhenEnabled(
          useAnthropicCompat,
          settings.anthropicOpusModel,
          process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        ),
        anthropicSonnetModel: preferSettingWhenEnabled(
          useAnthropicCompat,
          settings.anthropicSonnetModel,
          process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        ),
        anthropicHaikuModel: preferSettingWhenEnabled(
          useAnthropicCompat,
          settings.anthropicHaikuModel,
          process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        ),
        claudeCodeSubagentModel: preferSettingWhenEnabled(
          useAnthropicCompat,
          settings.claudeCodeSubagentModel,
          process.env.CLAUDE_CODE_SUBAGENT_MODEL,
        ),
        maxTurns: process.env.CLAUDE_AGENT_MAX_TURNS
          ? parseInt(process.env.CLAUDE_AGENT_MAX_TURNS, 10)
          : settings.maxTurns,
        permissionMode: process.env.CLAUDE_AGENT_PERMISSION_MODE || settings.permissionMode,
      });
    default:
      return {};
  }
}

const providerFactories: Record<string, ProviderFactory> = {
  codex: (config) =>
    new CodexProvider({
      bin: config?.bin as string | undefined,
      timeoutMs: config?.timeoutMs as number | undefined,
      codexCompatEnabled: config?.codexCompatEnabled as boolean | undefined,
      codexUpstreamFormat: config?.codexUpstreamFormat as "responses" | "anthropic" | undefined,
      codexAdapterBaseUrl: config?.codexAdapterBaseUrl as string | undefined,
      codexAnthropicBaseUrl: config?.codexAnthropicBaseUrl as string | undefined,
      codexApiKey: config?.codexApiKey as string | undefined,
      codexDefaultModel: config?.codexDefaultModel as string | undefined,
      codexFastModel: config?.codexFastModel as string | undefined,
      codexCodeModel: config?.codexCodeModel as string | undefined,
    }),
  "claude-code": (config) =>
    new ClaudeCodeProvider({
      pathToClaudeCodeExecutable: config?.pathToClaudeCodeExecutable as string | undefined,
      maxTurns: config?.maxTurns as number | undefined,
      timeoutMs: config?.timeoutMs as number | undefined,
      permissionMode: config?.permissionMode as PermissionMode | undefined,
      defaultModel: config?.defaultModel as string | undefined,
      apiKey: config?.apiKey as string | undefined,
      apiKeyHelper: config?.apiKeyHelper as string | undefined,
      anthropicBaseUrl: config?.anthropicBaseUrl as string | undefined,
      anthropicAutoModel: config?.anthropicAutoModel as string | undefined,
      anthropicOpusModel: config?.anthropicOpusModel as string | undefined,
      anthropicSonnetModel: config?.anthropicSonnetModel as string | undefined,
      anthropicHaikuModel: config?.anthropicHaikuModel as string | undefined,
      claudeCodeSubagentModel: config?.claudeCodeSubagentModel as string | undefined,
    }),
};

export function normalizeProviderType(type: string): string {
  return type === "claude-agent" ? "claude-code" : type;
}

export function getRegisteredProviderTypes(): string[] {
  return Object.keys(providerFactories);
}

function getProviderBin(type: string, config: Record<string, unknown>): string {
  switch (normalizeProviderType(type)) {
    case "codex":
      return resolveCodexExecutable(config.bin as string | undefined).bin;
    case "claude-code":
      return (config.pathToClaudeCodeExecutable as string | undefined) || "bundled Claude Code";
    default:
      return type;
  }
}

function getProviderInstallHint(type: string): string {
  switch (normalizeProviderType(type)) {
    case "codex":
      return "请在设置页下载内置组件；如需使用外部 CLI，可设置 CODEX_BIN 为可执行文件路径";
    case "claude-code":
      return "请在设置页下载内置组件；如需指定外部 CLI，可设置 CLAUDE_CODE_BIN";
    default:
      return "";
  }
}

export function getProviderInstallationStatus(type: string): ProviderInstallationStatus {
  const normalizedType = normalizeProviderType(type);
  const config = getProviderConfig(normalizedType);
  if (normalizedType === "codex") {
    const executable = resolveCodexExecutable(config.bin as string | undefined);
    return {
      installed: executable.executablePath !== null,
      bin: executable.bin,
      executablePath: executable.executablePath,
      installHint: getProviderInstallHint(normalizedType),
    };
  }
  const bin = getProviderBin(normalizedType, config);
  if (normalizedType === "claude-code" && !config.pathToClaudeCodeExecutable) {
    // 真实探测：已下载 > 随包平台包（dev）> 未安装
    const downloadedExecutable = getCliExecutablePath("claude-code");
    if (downloadedExecutable) {
      return {
        installed: true,
        bin: "已下载的 Claude Code",
        executablePath: downloadedExecutable,
        installHint: getProviderInstallHint(normalizedType),
      };
    }
    return {
      installed: isBundledClaudeAvailable(),
      bin,
      executablePath: null,
      installHint: getProviderInstallHint(normalizedType),
    };
  }
  const executablePath = resolveExecutable(bin);
  return {
    installed: executablePath !== null,
    bin,
    executablePath,
    installHint: getProviderInstallHint(normalizedType),
  };
}

export function createProvider(type: string, config?: Record<string, unknown>): IProvider {
  const normalizedType = normalizeProviderType(type);
  const factory = providerFactories[normalizedType];
  if (!factory) {
    throw new Error(
      `不支持的 Provider: ${type}。可用: ${Object.keys(providerFactories).join(", ")}`,
    );
  }
  const mergedConfig = {
    ...getProviderConfig(normalizedType),
    ...dropUndefined(config || {}),
  };
  return factory(mergedConfig);
}

let currentProvider: IProvider | null = null;

export function getProvider(): IProvider {
  if (!currentProvider) {
    throw new Error("Provider 尚未初始化");
  }
  return currentProvider;
}

export function initProvider(type: string, config?: Record<string, unknown>): IProvider {
  currentProvider = createProvider(type, config);
  return currentProvider;
}

export function switchProvider(type: string, config?: Record<string, unknown>): IProvider {
  currentProvider = createProvider(type, config);
  return currentProvider;
}

export type {
  IProvider,
  RunOptions,
  RunResult,
  ProviderModel,
  ProviderCapabilities,
  ProviderConfig,
} from "./types.js";
export { CodexProvider } from "./codex.js";
export { ClaudeCodeProvider } from "./claude-code.js";
export {
  ProviderTimeoutError,
  ProviderProcessError,
  ProviderEmptyOutputError,
  ProviderParseError,
  ProviderExecutableNotFoundError,
} from "./codex.js";
