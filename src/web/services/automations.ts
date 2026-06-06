import { generateId } from "../../shared.js";
import * as db from "../db.js";

export type AutomationScheduleType = "minutes" | "hourly" | "daily" | "weekly" | "cron";
export type AutomationRunStatus = "pending" | "running" | "success" | "failed";
export type AutomationDeliveryStatus = "none" | "local" | "delivered" | "delivery_failed";

export interface AutomationSkillConfig {
  id: string;
  name: string;
  source?: string;
}

export interface AutomationScheduleConfig {
  type: AutomationScheduleType;
  intervalMinutes?: number;
  time?: string;
  weekday?: number;
  cron?: string;
}

export interface AutomationConfig {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  provider: string;
  modelId: string | null;
  projectId: string | null;
  channelType: string;
  skills: AutomationSkillConfig[];
  schedule: AutomationScheduleConfig;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  sessionId: string | null;
  status: AutomationRunStatus;
  deliveryStatus: AutomationDeliveryStatus;
  output: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export interface AutomationRunPage {
  runs: AutomationRun[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type AutomationInput = Partial<Omit<AutomationConfig, "id" | "createdAt" | "updatedAt" | "nextRunAt">>;

const changeListeners = new Set<() => void>();

function emitAutomationsChanged(): void {
  for (const listener of changeListeners) {
    listener();
  }
}

export function onAutomationsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value: unknown): string {
  return cleanText(value).slice(0, 200);
}

function isScheduleType(value: unknown): value is AutomationScheduleType {
  return value === "minutes" || value === "hourly" || value === "daily" || value === "weekly" || value === "cron";
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeWeekday(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 6 ? Math.floor(parsed) : 1;
}

function normalizeTime(value: unknown): string {
  const text = cleanText(value);
  if (!/^\d{2}:\d{2}$/.test(text)) return "09:00";
  const [hour, minute] = text.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? text : "09:00";
}

function normalizeSchedule(value: unknown): AutomationScheduleConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = isScheduleType(raw.type) ? raw.type : "minutes";
  const schedule: AutomationScheduleConfig = { type };
  if (type === "minutes") schedule.intervalMinutes = normalizePositiveInt(raw.intervalMinutes, 30);
  if (type === "daily" || type === "weekly") schedule.time = normalizeTime(raw.time);
  if (type === "weekly") schedule.weekday = normalizeWeekday(raw.weekday);
  if (type === "cron") schedule.cron = cleanText(raw.cron) || "0 9 * * 1";
  return schedule;
}

function normalizeSkills(value: unknown): AutomationSkillConfig[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const raw: Record<string, unknown> = item && typeof item === "object" ? item as Record<string, unknown> : { id: item, name: item };
    const id = cleanId(raw.id);
    const name = cleanText(raw.name || raw.id);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    const source = cleanText(raw.source);
    return [{ id, name, ...(source ? { source } : {}) }];
  });
}

function normalizeAutomation(value: unknown, existing?: AutomationConfig): AutomationConfig | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id) || existing?.id || "";
  const name = cleanText(raw.name);
  const prompt = cleanText(raw.prompt);
  const provider = cleanId(raw.provider);
  const channelType = cleanId(raw.channelType);
  if (!id || !name || !prompt || !provider || !channelType) return null;
  const createdAt = normalizePositiveInt(raw.createdAt, existing?.createdAt || Date.now());
  const schedule = normalizeSchedule(raw.schedule);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : existing?.enabled ?? true;
  return {
    id,
    name,
    prompt,
    enabled,
    provider,
    modelId: cleanId(raw.modelId) || null,
    projectId: cleanId(raw.projectId) || null,
    channelType,
    skills: normalizeSkills(raw.skills),
    schedule,
    nextRunAt: enabled ? computeNextRunAt(schedule) : null,
    createdAt,
    updatedAt: normalizePositiveInt(raw.updatedAt, Date.now()),
  };
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function rowToAutomation(row: db.AutomationRow): AutomationConfig {
  const schedule = normalizeSchedule(parseJsonObject(row.scheduleJson));
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    provider: row.provider,
    modelId: row.modelId,
    projectId: row.projectId,
    channelType: row.channelType,
    skills: normalizeSkills(parseJsonArray(row.skillsJson)),
    schedule,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function automationToRow(automation: AutomationConfig): db.AutomationRow {
  return {
    id: automation.id,
    name: automation.name,
    prompt: automation.prompt,
    enabled: automation.enabled ? 1 : 0,
    provider: automation.provider,
    modelId: automation.modelId,
    projectId: automation.projectId,
    channelType: automation.channelType,
    skillsJson: JSON.stringify(automation.skills),
    scheduleJson: JSON.stringify(automation.schedule),
    nextRunAt: automation.nextRunAt,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}

function rowToRun(row: db.AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    sessionId: row.sessionId,
    status: row.status as AutomationRunStatus,
    deliveryStatus: row.deliveryStatus as AutomationDeliveryStatus,
    output: row.output,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

function runToRow(run: AutomationRun): db.AutomationRunRow {
  return run;
}

function buildAutomation(input: AutomationInput, existing?: AutomationConfig): AutomationConfig {
  const now = Date.now();
  const next = normalizeAutomation({
    ...existing,
    ...input,
    id: existing?.id || generateId(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }, existing);
  if (!next) {
    throw new Error("自动化配置不完整");
  }
  next.nextRunAt = next.enabled ? computeNextRunAt(next.schedule, now) : null;
  next.updatedAt = now;
  return next;
}

function parseCronPart(part: string, min: number, max: number, opts: { sunday7?: boolean } = {}): Set<number> | null {
  const values = new Set<number>();
  for (const rawSegment of part.split(",")) {
    const segment = rawSegment.trim();
    if (!segment) return null;
    const [rangePart, stepPart] = segment.split("/");
    const step = stepPart == null ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return null;
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [rawStart, rawEnd] = rangePart.split("-").map(Number);
      start = rawStart;
      end = rawEnd;
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (opts.sunday7) {
      if (start === 7) start = 0;
      if (end === 7) end = 0;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < min || start > max || end < min || end > max) return null;
    if (start <= end) {
      for (let value = start; value <= end; value += step) values.add(value);
    } else {
      for (let value = start; value <= max; value += step) values.add(value);
      for (let value = min; value <= end; value += step) values.add(value);
    }
  }
  return values;
}

function computeCronNextRunAt(cron: string, from = Date.now()): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  const minutes = parseCronPart(minutePart, 0, 59);
  const hours = parseCronPart(hourPart, 0, 23);
  const days = parseCronPart(dayPart, 1, 31);
  const months = parseCronPart(monthPart, 1, 12);
  const weekdays = parseCronPart(weekdayPart, 0, 6, { sunday7: true });
  if (!minutes || !hours || !days || !months || !weekdays) return null;

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i += 1) {
    if (
      minutes.has(cursor.getMinutes()) &&
      hours.has(cursor.getHours()) &&
      days.has(cursor.getDate()) &&
      months.has(cursor.getMonth() + 1) &&
      weekdays.has(cursor.getDay())
    ) {
      return cursor.getTime();
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export function computeNextRunAt(schedule: AutomationScheduleConfig, from = Date.now()): number | null {
  const normalized = normalizeSchedule(schedule);
  const now = new Date(from);
  if (normalized.type === "minutes") {
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + Math.max(1, normalized.intervalMinutes || 30));
    if (next.getTime() <= from) next.setMinutes(next.getMinutes() + Math.max(1, normalized.intervalMinutes || 30));
    return next.getTime();
  }
  if (normalized.type === "hourly") {
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setHours(next.getHours() + 1);
    if (next.getTime() <= from) next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  if (normalized.type === "daily" || normalized.type === "weekly") {
    const [hour, minute] = (normalized.time || "09:00").split(":").map(Number);
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (normalized.type === "daily") {
      if (next.getTime() <= from) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
    const targetWeekday = normalizeWeekday(normalized.weekday);
    let daysAhead = (targetWeekday - next.getDay() + 7) % 7;
    if (daysAhead === 0 && next.getTime() <= from) daysAhead = 7;
    next.setDate(next.getDate() + daysAhead);
    return next.getTime();
  }
  if (normalized.type === "cron") {
    return computeCronNextRunAt(normalized.cron || "0 9 * * 1", from);
  }
  return null;
}

export function listAutomations(): AutomationConfig[] {
  return db.listAutomationRows().map(rowToAutomation);
}

export function getAutomation(id: string): AutomationConfig | null {
  const row = db.getAutomationRow(id);
  return row ? rowToAutomation(row) : null;
}

export function listDueAutomations(now = Date.now()): AutomationConfig[] {
  return db.listDueAutomationRows(now).map(rowToAutomation);
}

export function getNextAutomation(): AutomationConfig | null {
  const row = db.getNextAutomationRow();
  return row ? rowToAutomation(row) : null;
}

export function createAutomation(input: AutomationInput): AutomationConfig {
  const automation = buildAutomation(input);
  db.createAutomationRow(automationToRow(automation));
  emitAutomationsChanged();
  return automation;
}

export function updateAutomation(id: string, input: AutomationInput): AutomationConfig | null {
  const existing = getAutomation(id);
  if (!existing) return null;
  const automation = buildAutomation(input, existing);
  db.updateAutomationRow(automationToRow(automation));
  emitAutomationsChanged();
  return automation;
}

export function updateAutomationNextRunAt(id: string, nextRunAt: number | null): AutomationConfig | null {
  const existing = getAutomation(id);
  if (!existing) return null;
  const automation = {
    ...existing,
    nextRunAt,
    updatedAt: existing.updatedAt,
  };
  db.updateAutomationRow(automationToRow(automation));
  emitAutomationsChanged();
  return automation;
}

export function deleteAutomation(id: string): boolean {
  const deleted = db.deleteAutomationRow(id);
  if (deleted) emitAutomationsChanged();
  return deleted;
}

export function createAutomationRun(automationId: string): AutomationRun {
  const now = Date.now();
  const run: AutomationRun = {
    id: generateId(),
    automationId,
    sessionId: null,
    status: "running",
    deliveryStatus: "none",
    output: null,
    error: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
  };
  db.createAutomationRunRow(runToRow(run));
  return run;
}

export function updateAutomationRun(run: AutomationRun): AutomationRun {
  db.updateAutomationRunRow(runToRow(run));
  return run;
}

export function listAutomationRuns(automationId: string, page = 1, pageSize = 10): AutomationRunPage {
  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  const total = db.countAutomationRunRows(automationId);
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const normalizedPage = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  return {
    runs: db.listAutomationRunRows(automationId, normalizedPageSize, offset).map(rowToRun),
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages,
  };
}

export function pruneAutomationRuns(automationId: string, keep = 100): void {
  db.deleteOldAutomationRunRows(automationId, keep);
}
