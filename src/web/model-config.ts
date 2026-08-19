import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProvider,
  getRegisteredProviderTypes,
  switchProvider,
  createProvider,
  getProviderInstallationStatus,
} from "../providers/index.js";
import { EFFORT_LEVELS, CODEX_EFFORT_LEVELS, type EffortLevel } from "../providers/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.resolve(__dirname, "../../.data");
const CONFIG_PATH = path.join(dataDir, "model-config.json");

export interface ModelEntry {
  id: string;
  name: string;
  description: string;
}

export interface ModelConfig {
  provider: string;
  currentModel: string;
  models: ModelEntry[];
  lastSelected: Record<string, string>;
  /** 推理强度默认档位（当前 provider 生效的档位；未设置时由 SDK 用默认值 high） */
  effort?: EffortLevel;
  /** 各 provider 各自持久化的推理强度档位（claude-code 与 codex 档位集合不同） */
  lastEffort?: Record<string, EffortLevel>;
}

/** 各 provider 支持的推理强度档位；不支持的 provider 返回 null */
function effortLevelsForProvider(providerType: string): EffortLevel[] | null {
  if (providerType === "claude-code") return EFFORT_LEVELS;
  if (providerType === "codex") return CODEX_EFFORT_LEVELS;
  return null;
}

function buildDefaultConfig(): ModelConfig {
  const provider = getProvider();
  const models = provider.listModels();
  return {
    provider: provider.type,
    currentModel: models[0]?.id ?? "",
    models,
    lastSelected: { [provider.type]: models[0]?.id ?? "" },
  };
}

function ensureConfig(): void {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(buildDefaultConfig(), null, 2), "utf-8");
  }
}

export function readPersistedProviderType(): string | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const providerType = (JSON.parse(raw) as Partial<ModelConfig>).provider;
    if (!providerType) {
      return null;
    }

    const normalizedType = providerType === "claude-agent" ? "claude-code" : providerType;
    return getRegisteredProviderTypes().includes(normalizedType) ? normalizedType : null;
  } catch {
    return null;
  }
}

function areSameModels(a: ModelEntry[] | undefined, b: ModelEntry[]): boolean {
  return (
    !!a &&
    a.length === b.length &&
    a.every((model, index) => {
      const next = b[index];
      return (
        !!next &&
        model.id === next.id &&
        model.name === next.name &&
        model.description === next.description
      );
    })
  );
}

function selectCurrentModel(
  config: ModelConfig,
  providerType: string,
  models: ModelEntry[],
): string {
  const validIds = new Set(models.map((model) => model.id));
  const candidates = [
    config.provider === providerType ? config.currentModel : undefined,
    config.lastSelected[providerType],
    models[0]?.id,
  ];

  return candidates.find((modelId) => modelId && validIds.has(modelId)) ?? "";
}

export function readModelConfig(): ModelConfig {
  ensureConfig();
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw) as ModelConfig;

  if (!config.lastSelected) {
    config.lastSelected = {};
  }
  if (!config.lastEffort) {
    config.lastEffort = {};
  }

  const provider = getProvider();
  // 旧配置迁移：全局 effort 视为当前 provider 的档位
  if (config.effort && !config.lastEffort[provider.type]) {
    config.lastEffort[provider.type] = config.effort;
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  }
  // effort 字段始终镜像当前 provider 的档位，保证 GET 返回值与 provider 一致
  config.effort = config.lastEffort[provider.type];
  const providerModels = provider.listModels();
  const needsRefresh =
    config.provider !== provider.type ||
    !config.models ||
    config.models.length === 0 ||
    (config.models.length === 1 && config.models[0].id === "auto") ||
    !areSameModels(config.models, providerModels);

  if (needsRefresh) {
    const currentModel = selectCurrentModel(config, provider.type, providerModels);
    config.provider = provider.type;
    config.models = providerModels;
    config.currentModel = currentModel;
    config.lastSelected[provider.type] = currentModel;
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  }

  return config;
}

export function writeModelConfig(config: ModelConfig): ModelConfig {
  ensureConfig();
  const next: ModelConfig = {
    provider: config.provider,
    currentModel: config.currentModel || "",
    models: Array.isArray(config.models) ? config.models : [],
    lastSelected: config.lastSelected || {},
    lastEffort: config.lastEffort || {},
    effort: config.effort,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function getCurrentModel(): string {
  return readModelConfig().currentModel;
}

/** 读取持久化的推理强度档位（当前 provider；未设置时返回 undefined，运行时由 SDK 使用默认档位） */
export function getCurrentEffort(): EffortLevel | undefined {
  return readModelConfig().effort;
}

/** 校验并持久化当前 provider 的推理强度档位 */
export function setCurrentEffort(effort: EffortLevel): ModelConfig {
  const config = readModelConfig();
  const supportedLevels = effortLevelsForProvider(config.provider) || EFFORT_LEVELS;
  if (!supportedLevels.includes(effort)) {
    throw new Error(`不支持的强度: ${effort}`);
  }
  config.lastEffort![config.provider] = effort;
  config.effort = effort;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

/** 校验并持久化指定 provider 的推理强度档位（设置面板可为非当前 provider 配置默认强度） */
export function setEffortForProvider(providerType: string, effort: EffortLevel): ModelConfig {
  const supportedLevels = effortLevelsForProvider(providerType);
  if (!supportedLevels) {
    throw new Error(`该 Provider 不支持强度设置: ${providerType}`);
  }
  if (!supportedLevels.includes(effort)) {
    throw new Error(`不支持的强度: ${effort}`);
  }
  const config = readModelConfig();
  config.lastEffort![providerType] = effort;
  if (config.provider === providerType) {
    config.effort = effort;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return readModelConfigForProvider(providerType);
}

export function getCurrentProviderType(): string {
  return readModelConfig().provider;
}

export function getModelForProvider(providerType: string): string {
  return readModelConfigForProvider(providerType).currentModel;
}

export function readModelConfigForProvider(providerType: string): ModelConfig {
  ensureConfig();
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw) as ModelConfig;
  if (!config.lastSelected) {
    config.lastSelected = {};
  }
  if (!config.lastEffort) {
    config.lastEffort = {};
  }

  const provider = createProvider(providerType);
  const models = provider.listModels();
  const model = selectCurrentModel(config, provider.type, models);
  if (!config.lastSelected[provider.type]) {
    config.lastSelected[provider.type] = model;
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  }
  // 目标 provider 的持久化档位；旧配置的全局 effort 仅在其本就是当前 provider 时作为回落
  const effort =
    config.lastEffort[provider.type] ??
    (config.provider === provider.type ? config.effort : undefined);
  return {
    ...config,
    provider: provider.type,
    currentModel: model,
    models,
    effort,
  };
}

export function setCurrentModel(modelId: string): ModelConfig {
  const config = readModelConfig();
  const valid = config.models.some((m) => m.id === modelId);
  if (!valid) {
    throw new Error(`不支持的模型: ${modelId}`);
  }
  config.currentModel = modelId;
  config.lastSelected[config.provider] = modelId;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export function setModelForProvider(providerType: string, modelId: string): ModelConfig {
  const provider = createProvider(providerType);
  const models = provider.listModels();
  const valid = models.some((m) => m.id === modelId);
  if (!valid) {
    throw new Error(`不支持的模型: ${modelId}`);
  }

  const config = readModelConfig();
  config.lastSelected[provider.type] = modelId;
  if (config.provider === provider.type) {
    config.currentModel = modelId;
    config.models = models;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");

  return {
    ...config,
    provider: provider.type,
    currentModel: modelId,
    models,
  };
}

export function setCurrentProvider(
  providerType: string,
  providerConfig?: Record<string, unknown>,
): ModelConfig {
  const registered = getRegisteredProviderTypes();
  if (!registered.includes(providerType)) {
    throw new Error(`不支持的 Provider: ${providerType}。可用: ${registered.join(", ")}`);
  }

  const installation = getProviderInstallationStatus(providerType);
  if (!installation.installed) {
    throw new Error(
      `${providerType} 未安装，无法切换。请先安装 ${installation.bin}：${installation.installHint}`,
    );
  }

  const config = readModelConfig();
  config.lastSelected[config.provider] = config.currentModel;
  config.provider = providerType;

  const newProvider = switchProvider(providerType, providerConfig);
  config.models = newProvider.listModels();
  config.currentModel = config.lastSelected[providerType] || config.models[0]?.id || "";

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export function getProviderTypes(): Array<{
  type: string;
  displayName: string;
  capabilities: Record<string, boolean>;
  installed: boolean;
  bin: string;
  executablePath: string | null;
  installHint: string;
}> {
  return getRegisteredProviderTypes().map((type) => {
    const p = createProvider(type);
    const installation = getProviderInstallationStatus(type);
    return {
      type: p.type,
      displayName: p.displayName,
      capabilities: { ...p.capabilities },
      installed: installation.installed,
      bin: installation.bin,
      executablePath: installation.executablePath,
      installHint: installation.installHint,
    };
  });
}
