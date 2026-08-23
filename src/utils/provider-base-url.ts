// AnyBot 设置页在本地兼容服务地址后拼接的识别标识（如 http://localhost:8080?anybot=llama），
// 仅用于识别服务类型、免鉴权和模型建议；注入 CLI/SDK 或发起真实请求前必须剥离。
// 参数名故意用应用专属的 anybot，避免与服务自身可能使用的通用 query 参数（如 type）冲突。

const PROVIDER_BASE_URL_MARKER_RE = /[?&]anybot=([a-z0-9-]+)(?=[&#]|$)/i;

/** 读取 Base URL 上的 anybot 标识（小写），没有则返回空串 */
export function getProviderBaseUrlType(baseUrl: string): string {
  const match = PROVIDER_BASE_URL_MARKER_RE.exec(baseUrl.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * 识别本地免鉴权兼容服务：优先认 ?anybot=ollama / ?anybot=llama 标识（任意端口），
 * 回环默认端口兜底（Ollama 11434、llama 8080）。不是本地服务返回空串。
 */
export function getLocalProviderBaseUrlType(baseUrl: string | undefined): "ollama" | "llama" | "" {
  if (!baseUrl) return "";
  const trimmed = baseUrl.trim();
  const marker = getProviderBaseUrlType(trimmed);
  if (marker === "ollama" || marker === "llama") return marker;
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]):11434(\/|$)/i.test(trimmed)) return "ollama";
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]):8080(\/|$)/i.test(trimmed)) return "llama";
  return "";
}

/** 剥离 Base URL 上的 anybot 标识，保留其余 query；无标识时返回原值（trim 后） */
export function stripProviderBaseUrlType(baseUrl: string): string;
export function stripProviderBaseUrlType(baseUrl: string | undefined): string | undefined;
export function stripProviderBaseUrlType(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return baseUrl;
  return baseUrl
    .trim()
    // 标识是首个参数且后面还有参数：保留 '?' 衔接后续参数
    .replace(/\?anybot=[a-z0-9-]+&(?=[^&#])/i, "?")
    // 其余情况连同分隔符整体去掉
    .replace(/([?&])anybot=[a-z0-9-]+(?=[&#]|$)/i, "")
    .replace(/[?&]$/, "");
}
