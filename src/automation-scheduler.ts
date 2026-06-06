import {
  getNextAutomation,
  listDueAutomations,
  computeNextRunAt,
  updateAutomationNextRunAt,
  onAutomationsChanged,
  markInterruptedAutomationRuns,
} from "./web/services/automations.js";
import { runAutomation } from "./web/services/automation-runner.js";
import { logger } from "./logger.js";

const MAX_TIMEOUT_MS = 2_147_000_000;

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
          await runAutomation(automation, { updateNextRunAt: true });
        }
      }
    } finally {
      this.processing = false;
      this.scheduleNext();
    }
  }
}

export const automationScheduler = new AutomationScheduler();
