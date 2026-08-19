import type { Server } from "node:http";
import { applyProxy } from "./proxy.js";
import { ensureExecutablePathEnv } from "./utils/process.js";
import { getConfiguredWebPort } from "./app-settings.js";
import { createApp } from "./web/server.js";
import { writeApiTokenFile } from "./web/auth.js";

import {
  initProvider,
  getProviderConfig,
  getRegisteredProviderTypes,
  normalizeProviderType,
} from "./providers/index.js";
import {
  includeContentInLogs,
  includePromptInLogs,
  logger,
} from "./logger.js";
import {
  getCurrentModel,
  readPersistedProviderType,
  readModelConfig,
  readModelConfigForProvider,
  setCurrentProvider,
  setCurrentModel,
  getProviderTypes,
} from "./web/model-config.js";
import { startAllChannels, stopAllChannels } from "./channels/index.js";
import { automationScheduler } from "./automation-scheduler.js";
import type { ChannelCallbacks } from "./channels/index.js";
import {
  getWorkdir,
  getSandbox,
} from "./shared.js";
import { startDesktopUpdateAutoCheck } from "./web/services/desktop-update.js";
import { verifyMcpServersOnStartup } from "./web/services/mcp.js";
import {
  createActiveAgentStream,
  emitAgentStream,
  finishAgentStream,
  hasActiveAgentStream,
  type AgentStreamEvent,
} from "./web/agent-stream.js";
import {
  canStreamPreparedChatTurn,
  createChannelSession,
  getSessionWorkdir,
  getOrCreateChannelSession,
  prepareChatTurn,
  resetChannelSession,
  runPreparedChatTurn,
} from "./chat-runner.js";
import { abortAllActiveRuns, clearActiveRun, createActiveRun } from "./web/active-runs.js";
import * as db from "./web/db.js";

ensureExecutablePathEnv();

function resolveInitialProviderType(): string {
  const persisted = readPersistedProviderType();
  if (persisted) return persisted;

  const requested = normalizeProviderType(process.env.PROVIDER || "codex");
  if (getRegisteredProviderTypes().includes(requested)) return requested;

  logger.warn("provider.initial_unsupported", {
    provider: requested,
    fallback: "codex",
    available: getRegisteredProviderTypes(),
  });
  return "codex";
}

const providerType = resolveInitialProviderType();

const provider = initProvider(providerType, getProviderConfig(providerType));

// --- Core logic ---

async function generateReply(
  chatId: string,
  userText: string,
  imagePaths: string[] = [],
  source: string = "unknown",
): Promise<string> {
  const dbSession = getOrCreateChannelSession(source, chatId);
  const workdir = getSessionWorkdir(dbSession);
  const prepared = prepareChatTurn({
    session: dbSession,
    userText,
    storedUserContent: userText,
    imagePaths,
    workdir,
    includeWorkspaceMemory: !dbSession.projectId,
  });
  const activeRun = createActiveRun(dbSession.id, "message");
  const active = canStreamPreparedChatTurn(prepared) && !hasActiveAgentStream(dbSession.id)
    ? createActiveAgentStream(dbSession.id)
    : null;
  const emit = active
    ? (event: AgentStreamEvent) => emitAgentStream(active, event)
    : undefined;

  try {
    const result = await runPreparedChatTurn(prepared, {
      signal: activeRun.controller.signal,
      stream: emit ? { emit } : undefined,
      logPrefix: "reply.generate",
      logFields: { chatId, source, dbSessionId: dbSession.id },
    });
    return result.content;
  } finally {
    clearActiveRun(dbSession.id, activeRun.controller);
    if (active) {
      finishAgentStream(dbSession.id, active);
    }
  }
}

// --- Channel callbacks ---

function listProviders() {
  const config = readModelConfig();
  return getProviderTypes().map((p) => ({
    type: p.type,
    displayName: p.displayName,
    isCurrent: p.type === config.provider,
  }));
}

function handleSwitchProvider(providerType: string) {
  try {
    const config = setCurrentProvider(providerType, getProviderConfig(providerType));
    return {
      success: true,
      message: `已切换到 ${providerType}，当前模型: ${config.currentModel}`,
    };
  } catch (e: any) {
    return { success: false, message: e.message || "切换供应商失败" };
  }
}

// 与 Web 端模型下拉（/api/model-config?provider=xxx）使用同一数据源：
// 通过 readModelConfigForProvider 实时从 provider 构建模型列表，避免渠道 /model 返回旧的持久化缓存
function listModels() {
  const config = readModelConfigForProvider(readModelConfig().provider);
  return config.models.map((m) => ({
    ...m,
    isCurrent: m.id === config.currentModel,
  }));
}

function handleSwitchModel(modelId: string) {
  try {
    // /model 列表展示的是映射后的名字（如 k3-256k），允许直接按展示名切换，先解析回模型 id 再持久化
    const target = listModels().find((m) => m.id === modelId || m.name === modelId);
    const config = setCurrentModel(target?.id ?? modelId);
    return {
      success: true,
      message: `已切换到模型: ${target?.name || config.currentModel}`,
    };
  } catch (e: any) {
    return { success: false, message: e.message || "切换模型失败" };
  }
}

function listWorkspaces(chatId: string, source: string) {
  const session = getOrCreateChannelSession(source, chatId);
  return [
    {
      id: null,
      name: "默认工作目录",
      path: getWorkdir(),
      isCurrent: !session.projectId,
    },
    ...db.listProjects().map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      isCurrent: session.projectId === project.id,
    })),
  ];
}

function handleSwitchWorkspace(
  chatId: string,
  source: string,
  workspaceId: string | null,
) {
  const project = workspaceId ? db.getProject(workspaceId) : null;
  if (workspaceId && !project) {
    return { success: false, message: "工作区不存在" };
  }

  const name = project?.name || "默认工作目录";
  resetChannelSession(chatId, source);
  createChannelSession(source, chatId, workspaceId);
  return { success: true, message: `工作区切换成功，当前工作区: ${name}，新对话已开启` };
}

const channelCallbacks: ChannelCallbacks = {
  generateReply: (chatId, userText, imagePaths, source) =>
    generateReply(chatId, userText, imagePaths, source),
  resetSession: resetChannelSession,
  listProviders,
  switchProvider: handleSwitchProvider,
  listModels,
  switchModel: handleSwitchModel,
  listWorkspaces,
  switchWorkspace: handleSwitchWorkspace,
};

// --- Startup ---

const WEB_PORT = getConfiguredWebPort();
const WEB_HOST = "127.0.0.1";

function exitWhenDesktopParentDies(): void {
  const parentPid = Number.parseInt(process.env.ANYBOT_DESKTOP_PARENT_PID || "", 10);
  if (!Number.isFinite(parentPid) || parentPid <= 0) {
    return;
  }

  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      logger.warn("desktop.parent_gone");
      shutdown("desktop_parent_gone");
    }
  }, 5000);

  timer.unref();
}

// --- Graceful shutdown ---

const SHUTDOWN_TIMEOUT_MS = 5_000;

let webServer: Server | null = null;
let shuttingDown = false;

function shutdown(signal: string, exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("service.stopping", { signal });

  const forceExit = setTimeout(() => {
    logger.warn("service.stop_timeout", { signal });
    process.exit(exitCode);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  void (async () => {
    try {
      const aborted = abortAllActiveRuns();
      if (aborted > 0) {
        logger.info("service.stop_aborted_runs", { count: aborted });
      }
      automationScheduler.stop();
      await stopAllChannels();
      if (webServer) {
        // SSE/agent streams keep connections open forever; drop them so
        // close() can settle instead of waiting for the force-exit timer.
        webServer.closeAllConnections();
        await new Promise<void>((resolve) => {
          webServer!.close(() => resolve());
        });
      }
    } catch (error) {
      logger.warn("service.stop_failed", { error });
    } finally {
      clearTimeout(forceExit);
      process.exit(exitCode);
    }
  })();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Last-resort safety net: a single bad message or failed write must not take
// down the whole service (channels, web UI, scheduler).
process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error });
});
process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { error: reason });
});

async function main(): Promise<void> {
  exitWhenDesktopParentDies();

  try {
    applyProxy();
  } catch (error) {
    logger.warn("proxy.init_failed", { error });
  }

  logger.info("service.starting", {
    provider: provider.type,
    providerDisplayName: provider.displayName,
    model: getCurrentModel(),
    workdir: getWorkdir(),
    sandbox: getSandbox(),
    logIncludeContent: includeContentInLogs(),
    logIncludePrompt: includePromptInLogs(),
    webHost: WEB_HOST,
    webPort: WEB_PORT,
  });

  const webApp = createApp();
  webServer = webApp.listen(WEB_PORT, WEB_HOST, () => {
    logger.info("web.started", { host: WEB_HOST, port: WEB_PORT });
    console.log(`AnyBot Web UI: http://${WEB_HOST}:${WEB_PORT}`);
    writeApiTokenFile();
    startDesktopUpdateAutoCheck();
    verifyMcpServersOnStartup();
  });

  const channels = await startAllChannels(channelCallbacks);
  automationScheduler.start();
  logger.info("service.started", {
    activeChannels: channels.map((c) => c.type),
  });
}

main().catch((error) => {
  logger.error("service.start_failed", { error });
  process.exit(1);
});
