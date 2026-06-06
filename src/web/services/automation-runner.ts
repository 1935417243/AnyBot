import {
  canStreamPreparedChatTurn,
  getSessionWorkdir,
  prepareChatTurn,
  runPreparedChatTurn,
} from "../../chat-runner.js";
import { channelManager } from "../../channels/index.js";
import { logger } from "../../logger.js";
import { generateId } from "../../shared.js";
import {
  clearActiveRun,
  createActiveRun,
} from "../active-runs.js";
import {
  createActiveAgentStream,
  emitAgentStream,
  finishAgentStream,
  hasActiveAgentStream,
  type AgentStreamEvent,
} from "../agent-stream.js";
import * as db from "../db.js";
import { emitSessionsChanged } from "../events.js";
import {
  computeNextRunAt,
  createAutomationRun,
  pruneAutomationRuns,
  updateAutomationNextRunAt,
  updateAutomationRun,
  type AutomationConfig,
  type AutomationDeliveryStatus,
  type AutomationRun,
} from "./automations.js";
import { prepareWebChatInput } from "./web-chat-input.js";

const LOCAL_CHANNEL_TYPE = "local";
const RUN_HISTORY_KEEP = 100;

interface AutomationRunOptions {
  updateNextRunAt?: boolean;
}

function createAutomationSession(automation: AutomationConfig): db.ChatSession {
  const now = Date.now();
  const session: db.ChatSession = {
    id: generateId(),
    title: "新对话",
    sessionId: null,
    provider: automation.provider,
    source: "web",
    chatId: null,
    projectId: automation.projectId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  db.createSession(session);
  emitSessionsChanged(session.id, "session_created");
  return session;
}

async function deliverAutomationResult(
  automation: AutomationConfig,
  output: string,
): Promise<{ status: AutomationDeliveryStatus; error: string | null }> {
  if (automation.channelType === LOCAL_CHANNEL_TYPE) {
    return { status: "local", error: null };
  }

  const channel = channelManager.getChannel(automation.channelType);
  if (!channel) {
    return { status: "delivery_failed", error: "交付方式未启动" };
  }

  try {
    await channel.sendToOwner(output);
    return { status: "delivered", error: null };
  } catch (error) {
    return {
      status: "delivery_failed",
      error: error instanceof Error ? error.message : "推送失败",
    };
  }
}

export function triggerAutomationRun(
  automation: AutomationConfig,
  options: AutomationRunOptions = {},
): AutomationRun {
  const run = createAutomationRun(automation.id);
  void executeAutomationRun(automation, run, options);
  return run;
}

export async function runAutomation(
  automation: AutomationConfig,
  options: AutomationRunOptions = {},
): Promise<AutomationRun> {
  const run = createAutomationRun(automation.id);
  await executeAutomationRun(automation, run, options);
  return run;
}

async function executeAutomationRun(
  automation: AutomationConfig,
  run: AutomationRun,
  options: AutomationRunOptions,
): Promise<void> {
  logger.info("automation.run.start", {
    automationId: automation.id,
    runId: run.id,
    channelType: automation.channelType,
  });

  try {
    const session = createAutomationSession(automation);
    run.sessionId = session.id;
    updateAutomationRun(run);

    const input = prepareWebChatInput(
      automation.prompt,
      [],
      automation.skills.map((skill) => ({ id: skill.id, name: skill.name })),
      [],
      [],
      { sessionProjectId: session.projectId },
    );
    const prepared = prepareChatTurn({
      session,
      userText: [
        "这是一次由本地自动化触发的任务，请直接完成任务内容，不需要解释触发过程。",
        "",
        `任务名称：${automation.name}`,
        "",
        input.userText,
      ].join("\n"),
      storedUserContent: input.storedUserContent,
      titleText: automation.name,
      userMetadata: input.userMetadata,
      imagePaths: input.imagePaths,
      modelId: automation.modelId || undefined,
      workdir: getSessionWorkdir(session),
      includeWorkspaceMemory: !session.projectId,
    });
    const activeRun = createActiveRun(session.id, "message");
    const active = canStreamPreparedChatTurn(prepared) && !hasActiveAgentStream(session.id)
      ? createActiveAgentStream(session.id)
      : null;
    const emit = active
      ? (event: AgentStreamEvent) => emitAgentStream(active, event)
      : undefined;
    const result = await runPreparedChatTurn(prepared, {
      signal: activeRun.controller.signal,
      stream: emit ? { emit } : undefined,
      logPrefix: "automation.run",
      logFields: { automationId: automation.id, runId: run.id },
    }).finally(() => {
      clearActiveRun(session.id, activeRun.controller);
      if (active) finishAgentStream(session.id, active);
    });
    const delivery = await deliverAutomationResult(automation, result.content);
    run.status = "success";
    run.deliveryStatus = delivery.status;
    run.output = result.content;
    run.error = delivery.error;
    run.finishedAt = Date.now();
    updateAutomationRun(run);
    logger.info("automation.run.success", {
      automationId: automation.id,
      runId: run.id,
      deliveryStatus: delivery.status,
    });
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "自动化执行失败";
    run.finishedAt = Date.now();
    updateAutomationRun(run);
    logger.error("automation.run.failed", {
      automationId: automation.id,
      runId: run.id,
      error,
    });
  } finally {
    if (options.updateNextRunAt) {
      updateAutomationNextRunAt(automation.id, computeNextRunAt(automation.schedule, Date.now()));
    }
    pruneAutomationRuns(automation.id, RUN_HISTORY_KEEP);
  }
}
