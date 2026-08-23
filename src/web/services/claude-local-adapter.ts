import type { Request, Response } from "express";
import { fetch as undiciFetch } from "undici";
import { getProviderRuntimeSettings } from "../../app-settings.js";
import { stripProviderBaseUrlType } from "../../utils/provider-base-url.js";
import { logger } from "../../logger.js";

// Claude Code 本地后端适配层：Claude Code 的 mid-conversation-system beta 会在
// messages 数组中间插入 role:"system" 的消息（anthropics/claude-code#74226，
// CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS 对该 beta 无效），本地服务（llama.cpp /
// Ollama）的 chat template 大多强制 system 只能在开头，直接 500。
// 这里只做一件事：把中间的 system 消息原位降级为 user 段并合并连续同角色消息，
// 其余请求/响应（含流式）原样透传。远程服务不经过这里。

type JsonObject = Record<string, unknown>;

function normalizeContent(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? [...content] : [];
}

/** 把 messages 中间的 system 消息原位改写为 user，并合并连续同角色消息 */
export function sanitizeAnthropicMessages(messages: unknown[]): Array<{ role: string; content: unknown[] }> {
  const out: Array<{ role: string; content: unknown[] }> = [];
  for (const raw of messages) {
    const msg = raw as JsonObject;
    if (!msg || typeof msg !== "object" || typeof msg.role !== "string") {
      out.push({ role: "user", content: normalizeContent(undefined) });
      continue;
    }
    const role = msg.role === "system" ? "user" : msg.role;
    const content = normalizeContent(msg.content);
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content.push(...content);
    } else {
      out.push({ role, content });
    }
  }
  return out;
}

function getAdapterUpstreamConfig(): { baseUrl: string; apiKey: string } {
  const settings = getProviderRuntimeSettings("claude-code");
  const baseUrl = stripProviderBaseUrlType(
    settings.anthropicBaseUrl?.trim() || process.env.ANTHROPIC_BASE_URL?.trim(),
  );
  const apiKey = settings.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
  if (!settings.anthropicCompatEnabled && !process.env.ANTHROPIC_BASE_URL) {
    throw new Error("Claude Code 兼容接口未开启");
  }
  if (!baseUrl) {
    throw new Error("缺少 Claude Code Anthropic Base URL");
  }
  return { baseUrl, apiKey };
}

/** 转发给上游时只保留语义相关的头，鉴权头优先用请求自带的（与 Claude Code 实际发送一致） */
function buildUpstreamHeaders(req: Request, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("anthropic-") || key === "accept") headers[key] = value;
  }
  const auth = req.headers["x-api-key"] || req.headers.authorization;
  if (typeof auth === "string" && auth) {
    if (req.headers["x-api-key"]) headers["x-api-key"] = auth;
    else headers.authorization = auth;
  } else if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

export async function handleClaudeLocalAdapterRequest(req: Request, res: Response): Promise<void> {
  let upstream: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    const { baseUrl, apiKey } = getAdapterUpstreamConfig();
    // req.path 形如 /v1/messages，保留原始 query（如 ?beta=true）
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const upstreamUrl = `${baseUrl.replace(/\/+$/, "")}${req.path}${query}`;

    let body = req.body as JsonObject | undefined;
    if (body && Array.isArray(body.messages)) {
      body = { ...body, messages: sanitizeAnthropicMessages(body.messages) };
    }

    const controller = new AbortController();
    // 客户端断开（取消/超时）时同步中断上游请求，避免本地模型空跑；
    // 注意监听 res 而非 req：Node 里 req 的 close 在请求体读完就会触发
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    upstream = await undiciFetch(upstreamUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(req, apiKey),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude 本地适配层请求失败";
    logger.warn("claude_local_adapter.upstream_failed", { error: message });
    res.status(502).json({
      type: "error",
      error: { type: "api_error", message },
    });
    return;
  }

  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.setHeader("content-type", contentType);
  // 响应（含 SSE 流式）字节透传，不解析、不缓冲
  if (!upstream.body) {
    res.end();
    return;
  }
  try {
    for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
    res.end();
  } catch {
    // 客户端中断导致的写入失败无需处理
    res.end();
  }
}
