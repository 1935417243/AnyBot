import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateId } from "../../shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.resolve(__dirname, "../../../.data");
const CONFIG_PATH = path.join(dataDir, "automations.json");

export type AutomationScheduleType = "minutes" | "hourly" | "daily" | "weekly" | "cron";

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
  createdAt: number;
  updatedAt: number;
}

interface AutomationsFile {
  automations: AutomationConfig[];
}

export type AutomationInput = Partial<Omit<AutomationConfig, "id" | "createdAt" | "updatedAt">>;

const DEFAULT_FILE: AutomationsFile = {
  automations: [],
};

function ensureConfig(): void {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_FILE, null, 2), "utf-8");
  }
}

function readFile(): AutomationsFile {
  ensureConfig();
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<AutomationsFile>;
    return {
      automations: Array.isArray(parsed.automations)
        ? parsed.automations.map(normalizeAutomation).filter((item): item is AutomationConfig => !!item)
        : [],
    };
  } catch {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_FILE, null, 2), "utf-8");
    return DEFAULT_FILE;
  }
}

function writeFile(file: AutomationsFile): AutomationsFile {
  const next = {
    automations: file.automations.map(normalizeAutomation).filter((item): item is AutomationConfig => !!item),
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
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
  return /^\d{2}:\d{2}$/.test(text) ? text : "09:00";
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

function normalizeAutomation(value: unknown): AutomationConfig | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const name = cleanText(raw.name);
  const prompt = cleanText(raw.prompt);
  const provider = cleanId(raw.provider);
  const channelType = cleanId(raw.channelType);
  if (!id || !name || !prompt || !provider || !channelType) return null;
  const createdAt = normalizePositiveInt(raw.createdAt, Date.now());
  return {
    id,
    name,
    prompt,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    provider,
    modelId: cleanId(raw.modelId) || null,
    projectId: cleanId(raw.projectId) || null,
    channelType,
    skills: normalizeSkills(raw.skills),
    schedule: normalizeSchedule(raw.schedule),
    createdAt,
    updatedAt: normalizePositiveInt(raw.updatedAt, createdAt),
  };
}

function buildAutomation(input: AutomationInput, existing?: AutomationConfig): AutomationConfig {
  const now = Date.now();
  const next = normalizeAutomation({
    ...existing,
    ...input,
    id: existing?.id || generateId(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  if (!next) {
    throw new Error("自动化配置不完整");
  }
  return next;
}

export function listAutomations(): AutomationConfig[] {
  return readFile().automations.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createAutomation(input: AutomationInput): AutomationConfig {
  const file = readFile();
  const automation = buildAutomation(input);
  writeFile({ automations: [automation, ...file.automations] });
  return automation;
}

export function updateAutomation(id: string, input: AutomationInput): AutomationConfig | null {
  const file = readFile();
  const index = file.automations.findIndex((automation) => automation.id === id);
  if (index < 0) return null;
  const automation = buildAutomation(input, file.automations[index]);
  file.automations[index] = automation;
  writeFile(file);
  return automation;
}

export function deleteAutomation(id: string): boolean {
  const file = readFile();
  const next = file.automations.filter((automation) => automation.id !== id);
  if (next.length === file.automations.length) return false;
  writeFile({ automations: next });
  return true;
}
