import type { IProvider } from "./types.js";
import { CodexProvider } from "./codex.js";

type ProviderFactory = (config?: Record<string, unknown>) => IProvider;

const providerFactories: Record<string, ProviderFactory> = {
  codex: (config) => new CodexProvider({ bin: config?.bin as string | undefined }),
};

export function getRegisteredProviderTypes(): string[] {
  return Object.keys(providerFactories);
}

export function createProvider(type: string, config?: Record<string, unknown>): IProvider {
  const factory = providerFactories[type];
  if (!factory) {
    throw new Error(
      `不支持的 Provider: ${type}。可用: ${Object.keys(providerFactories).join(", ")}`,
    );
  }
  return factory(config);
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
export {
  ProviderTimeoutError,
  ProviderProcessError,
  ProviderEmptyOutputError,
  ProviderParseError,
} from "./codex.js";
