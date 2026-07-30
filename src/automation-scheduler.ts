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
const MIN_DELAY_MS = 1_000;
const MIN_ERROR_RETRY_MS = 5_000;
const MAX_ERROR_RETRY_MS = 5 * 60_000;

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private processing = false;
  private consecutiveFailures = 0;
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
    // The running tick re-arms the timer from its finally block; scheduling
    // here would just spin on the still-due automation until the run ends.
    if (this.processing) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const next = getNextAutomation();
    if (!next?.nextRunAt) {
      logger.info("automation.scheduler.idle");
      return;
    }

    const backoffMs = this.consecutiveFailures > 0
      ? Math.min(MIN_ERROR_RETRY_MS * 2 ** (this.consecutiveFailures - 1), MAX_ERROR_RETRY_MS)
      : 0;
    const delay = Math.min(
      Math.max(next.nextRunAt - Date.now(), backoffMs, MIN_DELAY_MS),
      MAX_TIMEOUT_MS,
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick().catch((error) => {
        logger.error("automation.scheduler.tick_failed", { error });
        this.scheduleNext();
      });
    }, delay);
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
    if (this.processing) return;
    this.processing = true;
    try {
      while (!this.stopped) {
        const due = listDueAutomations(Date.now());
        if (due.length === 0) break;
        for (const automation of due) {
          await runAutomation(automation, { updateNextRunAt: true });
        }
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      throw error;
    } finally {
      this.processing = false;
      this.scheduleNext();
    }
  }
}

export const automationScheduler = new AutomationScheduler();
