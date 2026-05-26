import { createHash } from "node:crypto";
import { fetch as undiciFetch } from "undici";
import { logger } from "../../logger.js";
import { getObjectArrayValue, getObjectStringValue } from "./object-utils.js";

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

function buildProviderModelsRequest(baseUrl: string): { modelsUrl: string; provider: string } {
  const parsed = new URL(baseUrl);
  const lower = baseUrl.toLowerCase();
  if (lower.includes("vibeapi")) {
    return { modelsUrl: new URL("/v1/models", parsed.origin).toString(), provider: "VibeAPI" };
  }
  if (lower.includes("api.deepseek.com")) {
    return { modelsUrl: new URL("/models", parsed.origin).toString(), provider: "DeepSeek" };
  }
  if (lower.includes("api.minimaxi.com")) {
    return { modelsUrl: new URL("/anthropic/v1/models", parsed.origin).toString(), provider: "MiniMax" };
  }
  throw new Error("仅支持 VibeAPI、DeepSeek 或 MiniMax Base URL 自动获取模型");
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

export async function fetchProviderModels(baseUrl: string, apiKey: string): Promise<ProviderModelsResult> {
  if (!baseUrl || !apiKey) {
    throw new ProviderModelFetchError("缺少 Base URL 或 API Key", 400);
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
      error.message.includes("MiniMax")
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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

    const models = extractProviderModelIds(payload);
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
