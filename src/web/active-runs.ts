export type ActiveRunKind = "message" | "compact";

export type ActiveRunInfo = {
  kind: ActiveRunKind;
  startedAt: number;
};

type ActiveRun = ActiveRunInfo & {
  controller: AbortController;
};

const activeRuns = new Map<string, ActiveRun>();

export function createActiveRun(sessionId: string, kind: ActiveRunKind): ActiveRun {
  const run: ActiveRun = {
    controller: new AbortController(),
    kind,
    startedAt: Date.now(),
  };
  activeRuns.set(sessionId, run);
  return run;
}

export function clearActiveRun(sessionId: string, controller?: AbortController): void {
  const run = activeRuns.get(sessionId);
  if (!run) return;
  if (controller && run.controller !== controller) return;
  activeRuns.delete(sessionId);
}

export function getActiveRunController(sessionId: string): AbortController | null {
  return activeRuns.get(sessionId)?.controller || null;
}

export function getActiveRunInfo(sessionId: string): ActiveRunInfo | null {
  const run = activeRuns.get(sessionId);
  return run ? { kind: run.kind, startedAt: run.startedAt } : null;
}

export function hasActiveRun(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}
