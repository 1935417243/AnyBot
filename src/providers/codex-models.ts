import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import type { ProviderModel } from "./types.js";
import { getDataDir } from "../app-settings.js";
import { logger } from "../logger.js";
import { killProcessTree, spawnCommand } from "../utils/process.js";
import { emitModelConfigChanged } from "../web/events.js";

/** 模型清单缓存有效期，过期后下次读取时触发后台重新拉取 */
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
/** 单次拉取（启动 app-server、initialize 握手、model/list 分页）的超时 */
const MODELS_FETCH_TIMEOUT_MS = 20_000;
/** model/list 最多翻页次数，防止服务端游标异常导致死循环 */
const MODELS_MAX_PAGES = 10;
/** 本地持久化文件名（位于数据目录）；启动时先用它兜底，避免回落到内置清单冲掉用户已选模型 */
const MODELS_CACHE_FILE = "codex-models.json";

const moduleRequire = createRequire(import.meta.url);
const packageJson = moduleRequire("../../package.json") as { version?: unknown };
/** initialize 握手上报的客户端版本 */
const appVersion = typeof packageJson.version === "string" && packageJson.version.trim()
  ? packageJson.version.trim()
  : "0.0.0";

/** app-server model/list 返回的单个模型（仅声明用到的字段） */
type AppServerModel = {
  /** 预设 id */
  id?: unknown;
  /** 传给 Codex 的模型 slug */
  model?: unknown;
  /** 展示名称 */
  displayName?: unknown;
  /** 模型描述 */
  description?: unknown;
  /** 是否在默认模型选择列表中隐藏 */
  hidden?: unknown;
  /** 是否为当前账号的默认模型 */
  isDefault?: unknown;
};

/** app-server 输出的 JSON-RPC 消息（响应、通知或服务端请求） */
type AppServerMessage = {
  /** 请求/响应 id */
  id?: unknown;
  /** 通知或服务端请求的方法名；响应消息没有该字段 */
  method?: unknown;
  /** 成功响应的结果 */
  result?: unknown;
  /** 失败响应的错误信息 */
  error?: { message?: unknown } | null;
};

/** 实时拉取到的模型清单（内存缓存，所有 CodexProvider 实例共享） */
let cachedModels: ProviderModel[] | null = null;
/** 上次拉取结束的时间戳（成功或失败都会更新，避免频繁启动子进程） */
let lastFetchAt = 0;
/** 进行中的拉取任务，避免并发重复启动子进程 */
let fetchInflight: Promise<void> | null = null;
/** 是否已从本地持久化文件加载过模型清单 */
let diskCacheLoaded = false;

/** 取去除首尾空白的字符串，非字符串返回空串 */
function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 校验持久化文件中的单个模型条目 */
function isProviderModel(value: unknown): value is ProviderModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.name === "string" &&
    typeof record.description === "string"
  );
}

/** 本地持久化文件的绝对路径 */
function getModelsCachePath(): string {
  return path.join(getDataDir(), MODELS_CACHE_FILE);
}

/** 读取本地持久化的模型清单；文件不存在或格式不合法时返回 null */
function readPersistedModels(): ProviderModel[] | null {
  const filePath = getModelsCachePath();
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { models?: unknown };
    if (!Array.isArray(raw.models)) return null;
    const models = raw.models.filter(isProviderModel);
    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

/** 持久化模型清单，供下次启动时兜底 */
function writePersistedModels(models: ProviderModel[]): void {
  try {
    mkdirSync(getDataDir(), { recursive: true });
    writeFileSync(
      getModelsCachePath(),
      JSON.stringify({ fetchedAt: new Date().toISOString(), models }, null, 2),
      "utf-8",
    );
  } catch (err) {
    logger.warn("provider.models.persist_failed", {
      provider: "codex",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 将 app-server 返回的模型转换为 ProviderModel；过滤隐藏项，默认模型排在首位作为未选择时的默认值 */
function toProviderModels(items: AppServerModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  let defaultIndex = -1;
  for (const item of items) {
    if (item.hidden === true) continue;
    const id = getString(item.model) || getString(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (item.isDefault === true && defaultIndex < 0) defaultIndex = models.length;
    models.push({
      id,
      name: getString(item.displayName) || id,
      description: getString(item.description),
    });
  }
  if (defaultIndex > 0) models.unshift(...models.splice(defaultIndex, 1));
  return models;
}

/** 启动 codex app-server，经 JSON-RPC 调用 model/list 拉取当前账号可用的模型（不发起对话，不消耗额度） */
function fetchAppServerModels(executablePath: string): Promise<ProviderModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(executablePath, ["app-server"], { env: process.env });
    const items: AppServerModel[] = [];
    let timer: NodeJS.Timeout | undefined;
    let nextId = 0;
    let initializeId = -1;
    let listId = -1;
    let pages = 0;
    let stdoutBuffer = "";
    let stderrTail = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.stdin.end();
      killProcessTree(child, "SIGTERM");
      if (error) reject(error);
      else resolve(toProviderModels(items));
    };
    const request = (method: string, params: Record<string, unknown>): number => {
      const id = ++nextId;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return id;
    };
    const requestModelList = (cursor: string) => {
      pages++;
      listId = request("model/list", cursor ? { cursor } : {});
    };
    const handleMessage = (message: AppServerMessage) => {
      // 通知和服务端请求自带 method，其 id 与客户端请求 id 不在同一空间
      if (typeof message.method === "string") return;
      if (message.id !== initializeId && message.id !== listId) return;
      if (message.error) {
        finish(new Error(getString(message.error.message) || "codex app-server 返回错误"));
        return;
      }
      if (message.id === initializeId) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
        requestModelList("");
        return;
      }
      const result = (message.result || {}) as { data?: unknown; nextCursor?: unknown };
      if (Array.isArray(result.data)) items.push(...(result.data as AppServerModel[]));
      const nextCursor = getString(result.nextCursor);
      if (nextCursor && pages < MODELS_MAX_PAGES) requestModelList(nextCursor);
      else finish();
    };

    // 子进程提前退出时 stdin 写入会触发 EPIPE，由 exit 事件统一报错
    child.stdin.on("error", () => {});
    child.on("error", (err) => finish(err));
    child.on("exit", (code) => {
      finish(new Error(`codex app-server 提前退出（状态码 ${code ?? "unknown"}）：${stderrTail.trim()}`));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-500);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf("\n");
        if (!line) continue;
        let message: AppServerMessage;
        try {
          message = JSON.parse(line) as AppServerMessage;
        } catch {
          continue;
        }
        handleMessage(message);
      }
    });
    timer = setTimeout(() => finish(new Error("获取 Codex 模型列表超时")), MODELS_FETCH_TIMEOUT_MS);

    initializeId = request("initialize", {
      clientInfo: { name: "anybot", title: "AnyBot", version: appVersion },
      capabilities: null,
    });
  });
}

/** 缓存过期且没有进行中的任务时，后台拉取一次模型清单；清单变化后持久化并通知前端刷新 */
function refreshModelsIfStale(executablePath: string): void {
  if (fetchInflight || Date.now() - lastFetchAt < MODELS_CACHE_TTL_MS) return;

  fetchInflight = fetchAppServerModels(executablePath)
    .then((models) => {
      if (models.length === 0) return;
      const changed = JSON.stringify(models) !== JSON.stringify(cachedModels);
      cachedModels = models;
      if (!changed) return;
      logger.info("provider.models.refreshed", {
        provider: "codex",
        models: models.map((model) => model.id),
      });
      writePersistedModels(models);
      emitModelConfigChanged("codex", "models_refreshed");
    })
    .catch((err) => {
      logger.warn("provider.models.refresh_failed", {
        provider: "codex",
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      lastFetchAt = Date.now();
      fetchInflight = null;
    });
}

/**
 * 读取原生模式下 Codex CLI 当前账号可用的模型清单：首次读取先加载本地持久化结果，
 * 缓存过期时在后台重新拉取。尚无可用清单时返回空数组，由调用方使用内置兜底清单。
 */
export function getCodexNativeModels(executablePath: string | null): ProviderModel[] {
  if (!diskCacheLoaded) {
    diskCacheLoaded = true;
    cachedModels = readPersistedModels();
  }
  if (executablePath) refreshModelsIfStale(executablePath);
  return cachedModels ? [...cachedModels] : [];
}
