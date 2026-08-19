import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { fetch as undiciFetch } from "undici";
import { getProviderRuntimeSettings } from "../../app-settings.js";
import { publishCodexAdapterStreamEvent } from "../../codex-adapter-stream.js";
import { logger } from "../../logger.js";

type JsonObject = Record<string, unknown>;

type ResponsesRequest = {
  model?: string;
  input?: unknown;
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponsesTool[];
  tool_choice?: unknown;
  stream?: boolean;
  reasoning?: JsonObject;
};

type ResponsesTool = {
  type?: string;
  name?: string;
  description?: string;
  parameters?: JsonObject;
  input_schema?: JsonObject;
  format?: JsonObject;
  tools?: ResponsesTool[];
};

type ResponsesOutputItem = {
  type: string;
  id?: string;
  status?: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  namespace?: string;
  arguments?: string;
  summary?: Array<{ type: string; text: string; signature?: string }>;
};

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
};

type AnthropicContentBlock = {
  type: string;
  text?: string;
  source?: JsonObject;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  thinking?: string;
  signature?: string;
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
};

type AnthropicRequest = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: AnthropicContentBlock[];
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: JsonObject;
  }>;
  tool_choice?: unknown;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  output_config?: {
    effort?: string;
  };
};

type AnthropicResponse = {
  id?: string;
  model?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

type StreamBlockState = {
  type: "text" | "reasoning" | "tool_use";
  itemId: string;
  outputIndex: number;
  text: string;
  args: string;
  signature: string;
  name?: string;
  callId?: string;
};

type ThinkingState = {
  byCallId: Map<string, AnthropicContentBlock>;
  byTextHash: Map<string, AnthropicContentBlock>;
};

type ResponseToolIdentity = {
  name: string;
  namespace?: string;
};

type ToolConversion = {
  tools?: AnthropicRequest["tools"];
  responseToolByAnthropicName: Map<string, ResponseToolIdentity>;
  anthropicNameByResponseTool: Map<string, string>;
  uniqueNamespacedToolByBareName: Map<string, ResponseToolIdentity>;
};

type AnthropicRequestConversion = {
  request: AnthropicRequest;
  toolConversion: ToolConversion;
};

const DEFAULT_MAX_TOKENS = 65536;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const MAX_SESSION_STATES = 200;
const MAX_ANTHROPIC_TOOL_NAME_LENGTH = 64;
const thinkingStates = new Map<string, ThinkingState>();

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function getMessagesUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/messages`;
}

function getCodexSettings() {
  return getProviderRuntimeSettings("codex");
}

function isAdapterEnabled(): boolean {
  return getCodexSettings().codexCompatEnabled === true;
}

function resolveUpstreamModel(model: string | undefined): string {
  const settings = getCodexSettings();
  const requested = (model || "").trim();
  const defaultModel = settings.codexDefaultModel?.trim();
  const fastModel = settings.codexFastModel?.trim();
  const codeModel = settings.codexCodeModel?.trim();

  if (requested.includes("mini") && fastModel) return fastModel;
  if (requested.includes("codex") && codeModel) return codeModel;
  return defaultModel || "";
}

function getRequiredAdapterConfig(): {
  baseUrl: string;
  apiKey: string;
  upstreamModel: string;
} {
  const settings = getCodexSettings();
  const baseUrl = settings.codexAnthropicBaseUrl?.trim();
  const apiKey = settings.codexApiKey?.trim();
  const upstreamModel = settings.codexDefaultModel?.trim() || "";

  if (!settings.codexCompatEnabled) {
    throw new Error("Codex 适配层未开启");
  }
  if (!baseUrl) {
    throw new Error("缺少 Codex Anthropic Base URL");
  }
  if (!apiKey) {
    throw new Error("缺少 Codex API Key");
  }
  if (!upstreamModel) {
    throw new Error("缺少 Codex 默认模型映射");
  }
  return { baseUrl, apiKey, upstreamModel };
}

function appendMessage(messages: AnthropicMessage[], role: "user" | "assistant", content: AnthropicContentBlock[]): void {
  if (content.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    last.content.push(...content);
    return;
  }
  messages.push({ role, content: [...content] });
}

function textBlock(text: string): AnthropicContentBlock[] {
  return text ? [{ type: "text", text }] : [];
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { input: text };
  }
}

function responseToolKey(name: string, namespace?: string): string {
  return `${namespace || ""}\u0000${name}`;
}

function buildNamespacedToolName(name: string, namespace?: string): string {
  if (!namespace) return name;
  return namespace.endsWith("__") ? `${namespace}${name}` : `${namespace}__${name}`;
}

function normalizeAnthropicToolName(rawName: string, usedNames: Set<string>): string {
  const normalized = rawName.replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
  const suffix = `_${hashText(rawName).slice(0, 8)}`;
  const base = normalized.length > MAX_ANTHROPIC_TOOL_NAME_LENGTH
    ? `${normalized.slice(0, MAX_ANTHROPIC_TOOL_NAME_LENGTH - suffix.length)}${suffix}`
    : normalized;
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate)) {
    const collisionSuffix = `_${index}`;
    const truncated = base.slice(0, MAX_ANTHROPIC_TOOL_NAME_LENGTH - collisionSuffix.length);
    candidate = `${truncated}${collisionSuffix}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function resolveAnthropicToolUseName(
  name: string,
  namespace: string | undefined,
  toolConversion: ToolConversion | undefined,
): string {
  if (!toolConversion) return buildNamespacedToolName(name, namespace);
  return toolConversion.anthropicNameByResponseTool.get(responseToolKey(name, namespace))
    || buildNamespacedToolName(name, namespace);
}

function resolveResponseToolIdentity(
  anthropicName: string | undefined,
  toolConversion: ToolConversion | undefined,
): ResponseToolIdentity {
  const name = anthropicName || "tool";
  if (!toolConversion) return { name };
  return toolConversion.responseToolByAnthropicName.get(name)
    || toolConversion.uniqueNamespacedToolByBareName.get(name)
    || { name };
}

function contentPartsToBlocks(
  content: unknown,
  role: string,
  toolConversion?: ToolConversion,
): AnthropicContentBlock[] {
  if (typeof content === "string") return textBlock(content);
  if (!Array.isArray(content)) return textBlock(getString(content));

  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const item = part as JsonObject;
    const type = getString(item.type);
    if (type === "input_text" || type === "output_text" || type === "text") {
      blocks.push(...textBlock(getString(item.text)));
    } else if (type === "input_image" || type === "image_url") {
      throw new Error("Codex DeepSeek 适配层暂不支持图片输入");
    } else if (type === "refusal") {
      blocks.push(...textBlock(getString(item.refusal)));
    } else if (role === "assistant" && type === "tool_use") {
      const name = getString(item.name);
      const namespace = getString(item.namespace) || undefined;
      blocks.push({
        type: "tool_use",
        id: getString(item.id) || getString(item.call_id) || `call_${randomUUID()}`,
        name: resolveAnthropicToolUseName(name, namespace, toolConversion),
        input: item.input || {},
      });
    }
  }
  return blocks;
}

function reasoningBlocksFromSummary(summary: unknown): AnthropicContentBlock[] {
  if (!Array.isArray(summary)) return [];
  return summary
    .map((item): AnthropicContentBlock | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as JsonObject;
      const text = getString(record.text);
      const signature = getString(record.signature);
      if (!text && !signature) return null;
      return { type: "thinking", thinking: text, signature };
    })
    .filter((item): item is AnthropicContentBlock => Boolean(item));
}

function ensureThinkingBeforeToolUse(blocks: AnthropicContentBlock[], fallback?: AnthropicContentBlock): AnthropicContentBlock[] {
  if (blocks.some((block) => block.type === "thinking")) return blocks;
  return [fallback || { type: "thinking", thinking: "" }, ...blocks];
}

function inputToMessages(
  input: unknown,
  instructions: string | undefined,
  req: Request,
  toolConversion?: ToolConversion,
): {
  messages: AnthropicMessage[];
  system: AnthropicContentBlock[];
} {
  const messages: AnthropicMessage[] = [];
  const system = textBlock(instructions || "");
  const state = getThinkingState(req);
  let pendingReasoning: AnthropicContentBlock[] = [];

  if (typeof input === "string" || input === undefined || input === null) {
    appendMessage(messages, "user", textBlock(getString(input)));
    return { messages, system };
  }

  if (!Array.isArray(input)) {
    appendMessage(messages, "user", textBlock(JSON.stringify(input)));
    return { messages, system };
  }

  for (const rawItem of input) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as JsonObject;
    const type = getString(item.type);
    const role = getString(item.role);

    if (type === "reasoning") {
      pendingReasoning.push(...reasoningBlocksFromSummary(item.summary));
      continue;
    }

    if (type === "message" || role === "user" || role === "assistant" || role === "system") {
      if (role === "system") {
        system.push(...contentPartsToBlocks(item.content, role, toolConversion));
        continue;
      }
      const targetRole = role === "assistant" ? "assistant" : "user";
      let blocks = contentPartsToBlocks(item.content, targetRole, toolConversion);
      if (targetRole === "assistant" && pendingReasoning.length > 0) {
        blocks = [...pendingReasoning, ...blocks];
        pendingReasoning = [];
      }
      appendMessage(messages, targetRole, blocks);
      continue;
    }

    if (type === "function_call" || type === "custom_tool_call" || type === "local_shell_call") {
      const callId = getString(item.call_id) || getString(item.id) || `call_${randomUUID()}`;
      const name = getString(item.name) || getString(item.tool_name) || "tool";
      const namespace = getString(item.namespace) || undefined;
      let blocks: AnthropicContentBlock[] = [
        {
          type: "tool_use",
          id: callId,
          name: resolveAnthropicToolUseName(name, namespace, toolConversion),
          input: parseJsonObject(getString(item.arguments) || getString(item.input)),
        },
      ];
      const cached = state?.byCallId.get(callId);
      blocks = ensureThinkingBeforeToolUse([...pendingReasoning, ...blocks], cached);
      pendingReasoning = [];
      appendMessage(messages, "assistant", blocks);
      continue;
    }

    if (type === "function_call_output" || type === "custom_tool_call_output" || type === "local_shell_call_output") {
      appendMessage(messages, "user", [{
        type: "tool_result",
        tool_use_id: getString(item.call_id) || getString(item.id),
        content: getString(item.output) || JSON.stringify(item.output ?? ""),
      }]);
    }
  }

  if (pendingReasoning.length > 0) {
    appendMessage(messages, "assistant", pendingReasoning);
  }
  return { messages, system };
}

function convertTools(tools: ResponsesTool[] | undefined): ToolConversion {
  const converted: AnthropicRequest["tools"] = [];
  const responseToolByAnthropicName = new Map<string, ResponseToolIdentity>();
  const anthropicNameByResponseTool = new Map<string, string>();
  const namespacedToolIdentitiesByBareName = new Map<string, ResponseToolIdentity[]>();
  const usedNames = new Set<string>();
  const registerBareFallback = (identity: ResponseToolIdentity) => {
    if (!identity.namespace) return;
    const identities = namespacedToolIdentitiesByBareName.get(identity.name) || [];
    identities.push(identity);
    namespacedToolIdentitiesByBareName.set(identity.name, identities);
  };
  const visit = (items: ResponsesTool[] | undefined, namespace?: string) => {
    if (!Array.isArray(items)) return;
    for (const tool of items) {
      if (!tool || typeof tool !== "object") continue;
      if (tool.type === "namespace" && Array.isArray(tool.tools)) {
        visit(tool.tools, tool.name || namespace);
        continue;
      }
      if (Array.isArray(tool.tools)) {
        visit(tool.tools, namespace);
        continue;
      }
      const name = tool.name || tool.type;
      if (!name || name === "web_search_preview" || name === "web_search") continue;
      const identity: ResponseToolIdentity = namespace ? { name, namespace } : { name };
      const anthropicName = normalizeAnthropicToolName(buildNamespacedToolName(name, namespace), usedNames);
      responseToolByAnthropicName.set(anthropicName, identity);
      anthropicNameByResponseTool.set(responseToolKey(name, namespace), anthropicName);
      registerBareFallback(identity);
      const schema =
        tool.parameters ||
        tool.input_schema ||
        (tool.format && typeof tool.format === "object" ? tool.format : undefined) ||
        { type: "object", additionalProperties: true };
      converted.push({
        name: anthropicName,
        description: tool.description,
        input_schema: normalizeAnthropicToolSchema(tool, schema),
      });
    }
  };

  visit(tools);
  const uniqueNamespacedToolByBareName = new Map<string, ResponseToolIdentity>();
  for (const [name, identities] of namespacedToolIdentitiesByBareName) {
    const keys = new Set(identities.map((identity) => responseToolKey(identity.name, identity.namespace)));
    if (keys.size === 1) uniqueNamespacedToolByBareName.set(name, identities[0]);
  }

  return {
    tools: converted.length > 0 ? converted : undefined,
    responseToolByAnthropicName,
    anthropicNameByResponseTool,
    uniqueNamespacedToolByBareName,
  };
}

function normalizeAnthropicToolSchema(tool: ResponsesTool, schema: JsonObject): JsonObject {
  const schemaType = getString(schema.type);
  if (tool.type === "custom" || schemaType === "grammar") {
    return {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: `The input for the ${tool.name || tool.type || "custom"} tool.`,
        },
      },
      required: ["input"],
      additionalProperties: false,
    };
  }
  return schema;
}

function resolveReasoningEffort(reasoning: JsonObject | undefined): string | undefined {
  const effort = getString(reasoning?.effort).trim().toLowerCase();
  if (effort === "high") return "high";
  if (effort === "xhigh" || effort === "max") return "max";
  return undefined;
}

function toAnthropicRequest(openaiReq: ResponsesRequest, req: Request): AnthropicRequestConversion {
  const upstreamModel = resolveUpstreamModel(openaiReq.model);
  if (!upstreamModel) {
    throw new Error("缺少 Codex 默认模型映射");
  }
  const toolConversion = convertTools(openaiReq.tools);
  const converted = inputToMessages(openaiReq.input, openaiReq.instructions, req, toolConversion);
  const maxTokens = getNumber(openaiReq.max_output_tokens) || DEFAULT_MAX_TOKENS;
  const effort = resolveReasoningEffort(openaiReq.reasoning);
  const anthropicReq: AnthropicRequest = {
    model: upstreamModel,
    max_tokens: maxTokens,
    messages: converted.messages,
    stream: openaiReq.stream === true,
  };
  if (converted.system.length > 0) anthropicReq.system = converted.system;
  if (toolConversion.tools) anthropicReq.tools = toolConversion.tools;
  if (openaiReq.tool_choice !== undefined) {
    anthropicReq.tool_choice = normalizeToolChoice(openaiReq.tool_choice, toolConversion);
  }
  if (effort) anthropicReq.output_config = { effort };
  return { request: anthropicReq, toolConversion };
}

function normalizeToolChoice(toolChoice: unknown, toolConversion?: ToolConversion): unknown {
  if (typeof toolChoice === "string") {
    if (toolChoice === "auto" || toolChoice === "none") return { type: toolChoice };
    if (toolChoice === "required") return { type: "any" };
  }
  if (toolChoice && typeof toolChoice === "object") {
    const record = toolChoice as JsonObject;
    const type = getString(record.type);
    const name = getString((record.function as JsonObject | undefined)?.name) || getString(record.name);
    const namespace = getString(record.namespace) || undefined;
    if (type === "function" && name) {
      return { type: "tool", name: resolveAnthropicToolUseName(name, namespace, toolConversion) };
    }
  }
  return undefined;
}

function responseOutputFromAnthropic(
  content: AnthropicContentBlock[] | undefined,
  toolConversion?: ToolConversion,
): ResponsesOutputItem[] {
  const output: ResponsesOutputItem[] = [];
  let text = "";

  const flushText = () => {
    if (!text) return;
    output.push({
      type: "message",
      id: `msg_${randomUUID()}`,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }],
    });
    text = "";
  };

  for (const block of content || []) {
    if (block.type === "text") {
      text += block.text || "";
    } else if (block.type === "thinking" || block.type === "reasoning_content") {
      flushText();
      output.push({
        type: "reasoning",
        id: `rs_${randomUUID()}`,
        status: "completed",
        summary: [{
          type: "text",
          text: block.thinking || block.text || "",
          signature: block.signature,
        }],
      });
    } else if (block.type === "tool_use") {
      flushText();
      const identity = resolveResponseToolIdentity(block.name, toolConversion);
      output.push({
        type: "function_call",
        id: `fc_${randomUUID()}`,
        status: "completed",
        call_id: block.id || `call_${randomUUID()}`,
        name: identity.name,
        namespace: identity.namespace,
        arguments: JSON.stringify(block.input || {}),
      });
    }
  }
  flushText();
  return output;
}

function outputText(output: ResponsesOutputItem[]): string {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text || "")
    .join("");
}

function usageFromAnthropic(usage: AnthropicResponse["usage"]): ResponsesUsage {
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const cachedTokens = usage?.cache_read_input_tokens || 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    input_tokens_details: { cached_tokens: cachedTokens },
  };
}

function toOpenAIResponse(
  upstream: AnthropicResponse,
  requestedModel: string | undefined,
  toolConversion?: ToolConversion,
): JsonObject {
  const output = responseOutputFromAnthropic(upstream.content, toolConversion);
  return {
    id: upstream.id || `resp_${randomUUID()}`,
    object: "response",
    status: "completed",
    model: requestedModel || upstream.model,
    output,
    output_text: outputText(output),
    usage: usageFromAnthropic(upstream.usage),
  };
}

function sessionKeyFromRequest(req: Request): string {
  const sessionId = req.header("Session_id")?.trim();
  if (sessionId) return `session:${sessionId}`;
  const windowId = req.header("X-Codex-Window-Id")?.trim();
  if (windowId) return `codex-window:${windowId}`;
  return "";
}

function getThinkingState(req: Request): ThinkingState | null {
  const key = sessionKeyFromRequest(req);
  if (!key) return null;
  let state = thinkingStates.get(key);
  if (!state) {
    state = { byCallId: new Map(), byTextHash: new Map() };
    thinkingStates.set(key, state);
    while (thinkingStates.size > MAX_SESSION_STATES) {
      const oldest = thinkingStates.keys().next().value;
      if (!oldest) break;
      thinkingStates.delete(oldest);
    }
  } else {
    thinkingStates.delete(key);
    thinkingStates.set(key, state);
  }
  return state;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function rememberThinking(req: Request, content: AnthropicContentBlock[] | undefined): void {
  const state = getThinkingState(req);
  if (!state || !content) return;

  const thinking = content.find((block) => block.type === "thinking" && (block.thinking || block.signature));
  if (!thinking) return;

  const assistantText = content
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("");
  if (assistantText) state.byTextHash.set(hashText(assistantText), thinking);

  for (const block of content) {
    if (block.type === "tool_use" && block.id) {
      state.byCallId.set(block.id, thinking);
    }
  }
}

function upstreamHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "authorization": `Bearer ${apiKey}`,
    "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
    "user-agent": "AnyBot Codex Adapter",
  };
}

function writeOpenAIError(res: Response, status: number, message: string): void {
  res.status(status).json({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: status >= 500 ? "adapter_error" : "bad_request",
    },
  });
}

async function parseUpstreamError(response: { statusText: string; text(): Promise<string> }): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "上游请求失败";
  try {
    const payload = JSON.parse(text) as JsonObject;
    const error = payload.error;
    if (error && typeof error === "object") {
      return getString((error as JsonObject).message) || text;
    }
  } catch {
    return text;
  }
  return text;
}

export async function handleCodexResponsesRequest(req: Request, res: Response): Promise<void> {
  if (!isAdapterEnabled()) {
    writeOpenAIError(res, 404, "Codex 适配层未开启");
    return;
  }

  let adapterConfig: ReturnType<typeof getRequiredAdapterConfig>;
  try {
    adapterConfig = getRequiredAdapterConfig();
  } catch (error) {
    writeOpenAIError(res, 400, error instanceof Error ? error.message : "Codex 适配层配置无效");
    return;
  }

  let openaiReq: ResponsesRequest;
  try {
    openaiReq = (req.body || {}) as ResponsesRequest;
    const converted = toAnthropicRequest(openaiReq, req);
    const upstreamUrl = getMessagesUrl(adapterConfig.baseUrl);
    if (openaiReq.stream) {
      await streamAnthropicResponse(
        req,
        res,
        upstreamUrl,
        adapterConfig.apiKey,
        converted.request,
        openaiReq.model,
        converted.toolConversion,
      );
      return;
    }

    const upstream = await undiciFetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders(adapterConfig.apiKey),
      body: JSON.stringify(converted.request),
    });
    if (!upstream.ok) {
      writeOpenAIError(res, upstream.status >= 500 ? 502 : upstream.status, await parseUpstreamError(upstream));
      return;
    }

    const payload = (await upstream.json()) as AnthropicResponse;
    rememberThinking(req, payload.content);
    res.json(toOpenAIResponse(payload, openaiReq.model, converted.toolConversion));
  } catch (error) {
    logger.warn("codex_adapter.request_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    writeOpenAIError(res, 500, error instanceof Error ? error.message : "Codex 适配层请求失败");
  }
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function makeLifecycle(type: string, sequenceNumber: number, response: JsonObject): JsonObject {
  return { type, sequence_number: sequenceNumber, response };
}

async function streamAnthropicResponse(
  req: Request,
  res: Response,
  upstreamUrl: string,
  apiKey: string,
  anthropicReq: AnthropicRequest,
  requestedModel: string | undefined,
  toolConversion: ToolConversion,
): Promise<void> {
  const upstream = await undiciFetch(upstreamUrl, {
    method: "POST",
    headers: upstreamHeaders(apiKey),
    body: JSON.stringify({ ...anthropicReq, stream: true }),
  });
  if (!upstream.ok || !upstream.body) {
    writeOpenAIError(res, upstream.status >= 500 ? 502 : upstream.status, await parseUpstreamError(upstream));
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let sequence = 0;
  const nextSeq = () => {
    sequence += 1;
    return sequence;
  };
  const response: JsonObject = {
    id: `resp_${randomUUID()}`,
    object: "response",
    status: "in_progress",
    model: requestedModel || anthropicReq.model,
    output: [],
  };
  const output = response.output as ResponsesOutputItem[];
  const blocks = new Map<number, StreamBlockState>();
  const adapterRunId = getString(req.params.runId).trim();
  let inputTokens = 0;
  let outputTokens = 0;

  const sendCreated = () => {
    writeSse(res, "response.created", makeLifecycle("response.created", nextSeq(), response));
    writeSse(res, "response.in_progress", makeLifecycle("response.in_progress", nextSeq(), response));
  };
  let createdSent = false;

  const dispatchAnthropicEvent = (payload: JsonObject) => {
    const type = getString(payload.type);
    if (type === "message_start") {
      const message = payload.message as JsonObject | undefined;
      response.id = getString(message?.id) || response.id;
      response.model = requestedModel || getString(message?.model) || response.model;
      const usage = message?.usage as JsonObject | undefined;
      inputTokens = getNumber(usage?.input_tokens) || 0;
      if (!createdSent) {
        createdSent = true;
        sendCreated();
      }
      return;
    }

    if (!createdSent) {
      createdSent = true;
      sendCreated();
    }

    if (type === "content_block_start") {
      startStreamBlock(payload, output, blocks, res, nextSeq, toolConversion);
      return;
    }

    if (type === "content_block_delta") {
      updateStreamBlock(payload, blocks, res, nextSeq, adapterRunId);
      return;
    }

    if (type === "content_block_stop") {
      finishStreamBlock(payload, output, blocks, res, nextSeq);
      return;
    }

    if (type === "message_delta") {
      const usage = payload.usage as JsonObject | undefined;
      outputTokens = getNumber(usage?.output_tokens) || outputTokens;
    }
  };

  try {
    for await (const payload of readSsePayloads(upstream.body)) {
      dispatchAnthropicEvent(payload);
    }

    response.status = "completed";
    response.output_text = outputText(output);
    response.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      input_tokens_details: { cached_tokens: 0 },
    };
    rememberThinking(req, outputToAnthropicContent(output, toolConversion));
    writeSse(res, "response.completed", makeLifecycle("response.completed", nextSeq(), response));
    res.end();
  } catch (error) {
    response.status = "failed";
    response.error = {
      message: error instanceof Error ? error.message : "Codex 适配层流式请求失败",
      type: "server_error",
      code: "stream_error",
    };
    writeSse(res, "response.failed", makeLifecycle("response.failed", nextSeq(), response));
    res.end();
  }
}

async function* readSsePayloads(body: unknown): AsyncGenerator<JsonObject> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const payload = parseSseFrame(frame);
      if (payload) yield payload;
      index = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  const payload = parseSseFrame(buffer);
  if (payload) yield payload;
}

function parseSseFrame(frame: string): JsonObject | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as JsonObject;
  } catch {
    return null;
  }
}

function startStreamBlock(
  payload: JsonObject,
  output: ResponsesOutputItem[],
  blocks: Map<number, StreamBlockState>,
  res: Response,
  nextSeq: () => number,
  toolConversion: ToolConversion,
): void {
  const index = getNumber(payload.index) || 0;
  const block = payload.content_block as JsonObject | undefined;
  const blockType = getString(block?.type);
  if (blockType === "thinking" || blockType === "reasoning_content") {
    const item: ResponsesOutputItem = {
      type: "reasoning",
      id: `rs_${randomUUID()}`,
      status: "in_progress",
      summary: [],
    };
    const outputIndex = output.push(item) - 1;
    blocks.set(index, {
      type: "reasoning",
      itemId: item.id || "",
      outputIndex,
      text: getString(block?.thinking) || getString(block?.text),
      args: "",
      signature: getString(block?.signature),
    });
    writeSse(res, "response.output_item.added", {
      type: "response.output_item.added",
      sequence_number: nextSeq(),
      output_index: outputIndex,
      item,
    });
    writeSse(res, "response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      sequence_number: nextSeq(),
      item_id: item.id,
      output_index: outputIndex,
      summary_index: 0,
    });
    return;
  }

  if (blockType === "tool_use") {
    const identity = resolveResponseToolIdentity(getString(block?.name), toolConversion);
    const item: ResponsesOutputItem = {
      type: "function_call",
      id: `fc_${randomUUID()}`,
      status: "in_progress",
      call_id: getString(block?.id) || `call_${randomUUID()}`,
      name: identity.name,
      namespace: identity.namespace,
      arguments: "",
    };
    const outputIndex = output.push(item) - 1;
    blocks.set(index, {
      type: "tool_use",
      itemId: item.id || "",
      outputIndex,
      text: "",
      args: "",
      signature: "",
      callId: item.call_id,
      name: item.name,
    });
    writeSse(res, "response.output_item.added", {
      type: "response.output_item.added",
      sequence_number: nextSeq(),
      output_index: outputIndex,
      item,
    });
    return;
  }

  const item: ResponsesOutputItem = {
    type: "message",
    id: `msg_${randomUUID()}`,
    status: "in_progress",
    role: "assistant",
    content: [{ type: "output_text", text: "" }],
  };
  const outputIndex = output.push(item) - 1;
  blocks.set(index, {
    type: "text",
    itemId: item.id || "",
    outputIndex,
    text: getString(block?.text),
    args: "",
    signature: "",
  });
  writeSse(res, "response.output_item.added", {
    type: "response.output_item.added",
    sequence_number: nextSeq(),
    output_index: outputIndex,
    item,
  });
  writeSse(res, "response.content_part.added", {
    type: "response.content_part.added",
    sequence_number: nextSeq(),
    item_id: item.id,
    output_index: outputIndex,
    content_index: 0,
    part: { type: "output_text", text: "" },
  });
}

function updateStreamBlock(
  payload: JsonObject,
  blocks: Map<number, StreamBlockState>,
  res: Response,
  nextSeq: () => number,
  adapterRunId?: string,
): void {
  const index = getNumber(payload.index) || 0;
  const state = blocks.get(index);
  if (!state) return;
  const delta = payload.delta as JsonObject | undefined;
  const deltaType = getString(delta?.type);
  if (state.type === "text" && deltaType === "text_delta") {
    const text = getString(delta?.text);
    state.text += text;
    if (adapterRunId && text) {
      publishCodexAdapterStreamEvent(adapterRunId, { type: "answer_delta", text });
    }
    writeSse(res, "response.output_text.delta", {
      type: "response.output_text.delta",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: 0,
      delta: text,
    });
  } else if (state.type === "tool_use" && deltaType === "input_json_delta") {
    const partial = getString(delta?.partial_json);
    state.args += partial;
    writeSse(res, "response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta: partial,
    });
  } else if (state.type === "reasoning" && (deltaType === "thinking_delta" || deltaType === "reasoning_content_delta")) {
    const text = getString(delta?.thinking) || getString(delta?.text);
    state.text += text;
    if (adapterRunId && text) {
      publishCodexAdapterStreamEvent(adapterRunId, { type: "thinking_delta", text });
    }
    writeSse(res, "response.reasoning_summary_text.delta", {
      type: "response.reasoning_summary_text.delta",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      summary_index: 0,
      delta: text,
    });
  } else if (state.type === "reasoning" && deltaType === "signature_delta") {
    state.signature += getString(delta?.signature) || getString(delta?.text);
  }
}

function finishStreamBlock(
  payload: JsonObject,
  output: ResponsesOutputItem[],
  blocks: Map<number, StreamBlockState>,
  res: Response,
  nextSeq: () => number,
): void {
  const index = getNumber(payload.index) || 0;
  const state = blocks.get(index);
  if (!state) return;
  const item = output[state.outputIndex];
  if (!item) return;

  if (state.type === "text") {
    item.status = "completed";
    item.content = [{ type: "output_text", text: state.text }];
    writeSse(res, "response.output_text.done", {
      type: "response.output_text.done",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: 0,
      text: state.text,
    });
    writeSse(res, "response.content_part.done", {
      type: "response.content_part.done",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      content_index: 0,
      part: { type: "output_text", text: state.text },
    });
  } else if (state.type === "tool_use") {
    item.status = "completed";
    item.arguments = state.args || "{}";
    writeSse(res, "response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      arguments: item.arguments,
    });
  } else if (state.type === "reasoning") {
    item.status = "completed";
    item.summary = [{ type: "text", text: state.text, signature: state.signature }];
    writeSse(res, "response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      sequence_number: nextSeq(),
      item_id: state.itemId,
      output_index: state.outputIndex,
      summary_index: 0,
    });
  }

  writeSse(res, "response.output_item.done", {
    type: "response.output_item.done",
    sequence_number: nextSeq(),
    output_index: state.outputIndex,
    item,
  });
  blocks.delete(index);
}

function outputToAnthropicContent(
  output: ResponsesOutputItem[],
  toolConversion?: ToolConversion,
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const item of output) {
    if (item.type === "reasoning") {
      const summary = item.summary?.[0];
      blocks.push({ type: "thinking", thinking: summary?.text || "", signature: summary?.signature });
    } else if (item.type === "message") {
      blocks.push(...textBlock((item.content || []).map((part) => part.text || "").join("")));
    } else if (item.type === "function_call") {
      blocks.push({
        type: "tool_use",
        id: item.call_id,
        name: resolveAnthropicToolUseName(item.name || "tool", item.namespace, toolConversion),
        input: parseJsonObject(item.arguments || "{}"),
      });
    }
  }
  return blocks;
}

export function listCodexAdapterModels(): JsonObject {
  const models = [
    "gpt-5.6-sol",
    "gpt-mini",
    "gpt-codex",
  ];
  return {
    object: "list",
    data: models.map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "anybot",
    })),
    models,
  };
}
