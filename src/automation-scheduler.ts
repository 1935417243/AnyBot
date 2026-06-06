import {
  getNextAutomation,
  listDueAutomations,
  computeNextRunAt,
  createAutomationRun,
  updateAutomationNextRunAt,
  updateAutomationRun,
  pruneAutomationRuns,
  onAutomationsChanged,
  markInterruptedAutomationRuns,
  type AutomationConfig,
  type AutomationDeliveryStatus,
} from "./web/services/automations.js";
import {
  canStreamPreparedChatTurn,
  prepareChatTurn,
  runPreparedChatTurn,
  getSessionWorkdir,
} from "./chat-runner.js";
import { prepareWebChatInput } from "./web/services/web-chat-input.js";
import {
  clearActiveRun,
  createActiveRun,
} from "./web/active-runs.js";
import {
  createActiveAgentStream,
  emitAgentStream,
  finishAgentStream,
  hasActiveAgentStream,
  type AgentStreamEvent,
} from "./web/agent-stream.js";
import { channelManager } from "./channels/index.js";
import { emitSessionsChanged } from "./web/events.js";
import { logger } from "./logger.js";
import { generateId } from "./shared.js";
import * as db from "./web/db.js";

const LOCAL_CHANNEL_TYPE = "local";
const MAX_TIMEOUT_MS = 2_147_000_000;
const RUN_HISTORY_KEEP = 100;

interface AutomationRunOptions {
  updateNextRunAt: boolean;
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

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private processing = false;
  private recoveredInterruptedRuns = false;
  private unsubscribe: (() => void) | null = null;

  start(): void {
    if (this.unsubscribe) return;
    this.stopped = false;
    if (!this.recoveredInterruptedRuns) {
      this.recoveredInterruptedRuns = true;
      const interruptedRuns = markInterruptedAutomationRuns();
      if (interruptedRuns > 0) {
        logger.warn("automation.run.interrupted_recovered", { count: interruptedRuns });
      }
    }
    this.skipMissedRunsOnStartup();
    this.unsubscribe = onAutomationsChanged(() => this.scheduleNext());
    this.scheduleNext();
    logger.info("automation.scheduler.started");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    logger.info("automation.scheduler.stopped");
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const next = getNextAutomation();
    if (!next?.nextRunAt) {
      logger.info("automation.scheduler.idle");
      return;
    }

    const delay = Math.max(0, next.nextRunAt - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick().catch((error) => {
        logger.error("automation.scheduler.tick_failed", { error });
        this.scheduleNext();
      });
    }, Math.min(delay, MAX_TIMEOUT_MS));
    this.timer.unref();

    logger.info("automation.scheduler.next", {
      automationId: next.id,
      nextRunAt: next.nextRunAt,
      delayMs: delay,
    });
  }

  private skipMissedRunsOnStartup(): void {
    const now = Date.now();
    const due = listDueAutomations(now);
    for (const automation of due) {
      const nextRunAt = computeNextRunAt(automation.schedule, now);
      updateAutomationNextRunAt(automation.id, nextRunAt);
      logger.info("automation.scheduler.missed_skipped", {
        automationId: automation.id,
        missedRunAt: automation.nextRunAt,
        nextRunAt,
      });
    }
  }

  private async tick(): Promise<void> {
    if (this.processing) {
      this.scheduleNext();
      return;
    }
    this.processing = true;
    try {
      while (!this.stopped) {
        const due = listDueAutomations(Date.now());
        if (due.length === 0) break;
        for (const automation of due) {
          await this.runAutomation(automation);
        }
      }
    } finally {
      this.processing = false;
      this.scheduleNext();
    }
  }

  runOnce(automation: AutomationConfig): ReturnType<typeof createAutomationRun> {
    const run = createAutomationRun(automation.id);
    void this.executeAutomationRun(automation, run, { updateNextRunAt: false });
    return run;
  }

  private async runAutomation(automation: AutomationConfig): Promise<void> {
    const run = createAutomationRun(automation.id);
    await this.executeAutomationRun(automation, run, { updateNextRunAt: true });
  }

  private async executeAutomationRun(
    automation: AutomationConfig,
    run: ReturnType<typeof createAutomationRun>,
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
}

export const automationScheduler = new AutomationScheduler();
