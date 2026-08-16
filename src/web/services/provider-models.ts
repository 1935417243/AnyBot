import { createHash } from "node:crypto";
import { fetch as undiciFetch } from "undici";
import { logger } from "../../logger.js";
import { getObjectArrayValue, getObjectStringValue } from "./object-utils.js";
import { findStoredApiKeyForBaseUrl, SECRET_MASK } from "./secrets.js";

const PROVIDER_MODEL_FETCH_TIMEOUT_MS = 10000;
const PROVIDER_MODEL_CACHE_TTL_MS = 30 * 60 * 1000;

const providerModelCache = new Map<string, { expiresAt: number; models: string[]; provider: string }>();

export class ProviderModelFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ProviderModelFetchError";
  }
}

export type ProviderModelsResult = {
  models: string[];
  provider: string;
  cached: boolean;
  expiresAt: string;
};

function isOllamaBaseUrl(baseUrl: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]):11434(\/|$)/i.test(baseUrl.trim());
}

function buildProviderModelsRequest(baseUrl: string): { modelsUrl: string; provider: string } {
  const parsed = new URL(baseUrl);
  const lower = baseUrl.toLowerCase();
  if (lower.includes("token-plan.cn-beijing.maas.aliyuncs.com")) {
    return { modelsUrl: new URL("/compatible-mode/v1/models", parsed.origin).toString(), provider: "阿里Token Plan" };
  }
  if (lower.includes("vibeapi")) {
    return { modelsUrl: new URL("/v1/models", parsed.origin).toString(), provider: "VibeAPI" };
  }
  if (lower.includes("api.deepseek.com")) {
    return { modelsUrl: new URL("/models", parsed.origin).toString(), provider: "DeepSeek" };
  }
  if (lower.includes("api.minimaxi.com")) {
    return { modelsUrl: new URL("/anthropic/v1/models", parsed.origin).toString(), provider: "MiniMax" };
  }
  if (isOllamaBaseUrl(baseUrl)) {
    return { modelsUrl: new URL("/v1/models", parsed.origin).toString(), provider: "Ollama" };
  }
  throw new Error("仅支持 阿里Token Plan、VibeAPI、DeepSeek、MiniMax 或 Ollama Base URL 自动获取模型");
}

function getProviderModelCacheKey(modelsUrl: string, apiKey: string): string {
  return createHash("sha256").update(modelsUrl).update("\0").update(apiKey).digest("hex");
}

function extractProviderModelIds(payload: unknown): string[] {
  const data = getObjectArrayValue(payload, "data");
  const models = getObjectArrayValue(payload, "models");
  const source = Array.isArray(payload) ? payload : data || models || [];
  const ids = source
    .map((item) => {
      if (typeof item === "string") return item.trim();
      return (
        getObjectStringValue(item, "id") ||
        getObjectStringValue(item, "name") ||
        getObjectStringValue(item, "model")
      );
    })
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}

function filterProviderModelIds(provider: string, models: string[]): string[] {
  if (provider !== "阿里Token Plan") return models;
  return models.filter((model) => !model.toLowerCase().includes("image"));
}

export async function fetchProviderModels(baseUrl: string, apiKey: string): Promise<ProviderModelsResult> {
  if (!baseUrl) {
    throw new ProviderModelFetchError("缺少 Base URL", 400);
  }
  // 前端拿到的密钥是掩码,按 Base URL 换回已保存的真实密钥。
  if (apiKey === SECRET_MASK) {
    apiKey = findStoredApiKeyForBaseUrl(baseUrl);
  }
  if (!apiKey && !isOllamaBaseUrl(baseUrl)) {
    throw new ProviderModelFetchError("缺少 API Key", 400);
  }

  let modelsUrl: string;
  let provider: string;
  try {
    const request = buildProviderModelsRequest(baseUrl);
    modelsUrl = request.modelsUrl;
    provider = request.provider;
  } catch (error) {
    const msg = error instanceof Error && (
      error.message.includes("VibeAPI") ||
      error.message.includes("DeepSeek") ||
      error.message.includes("MiniMax") ||
      error.message.includes("Ollama") ||
      error.message.includes("阿里Token Plan")
    )
      ? error.message
      : "Base URL 无效";
    throw new ProviderModelFetchError(msg, 400);
  }

  const now = Date.now();
  const cacheKey = getProviderModelCacheKey(modelsUrl, apiKey);
  const cached = providerModelCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      models: cached.models,
      provider: cached.provider,
      cached: true,
      expiresAt: new Date(cached.expiresAt).toISOString(),
    };
  }
  if (cached) providerModelCache.delete(cacheKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_MODEL_FETCH_TIMEOUT_MS);
  try {
    const response = await undiciFetch(modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const upstreamError = getObjectStringValue(payload, "error") || text || "获取模型列表失败";
      throw new ProviderModelFetchError(upstreamError, response.status);
    }

    const models = filterProviderModelIds(provider, extractProviderModelIds(payload));
    if (models.length === 0) {
      throw new ProviderModelFetchError("模型列表为空或格式不支持", 502);
    }

    const expiresAt = Date.now() + PROVIDER_MODEL_CACHE_TTL_MS;
    providerModelCache.set(cacheKey, { models, provider, expiresAt });
    return { models, provider, cached: false, expiresAt: new Date(expiresAt).toISOString() };
  } catch (error) {
    if (error instanceof ProviderModelFetchError) throw error;
    const msg = error instanceof Error && error.name === "AbortError"
      ? "获取模型列表超时"
      : error instanceof Error
        ? error.message
        : "获取模型列表失败";
    logger.warn("provider_models.fetch_failed", {
      provider,
      modelsUrl,
      error: msg,
    });
    throw new ProviderModelFetchError(msg, 502);
  } finally {
    clearTimeout(timeout);
  }
}
