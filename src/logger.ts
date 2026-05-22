type LogLevel = "debug" | "info" | "warn" | "error";
type RawLogString = {
  __rawLogString: true;
  value: string;
};

import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { readAppSettings } from "./app-settings.js";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const logToStdout = resolveLogToStdout(process.env.LOG_TO_STDOUT);
const logDir = path.resolve(process.env.LOG_DIR || ".run");
const logBaseName = process.env.LOG_BASENAME || "bot.log";
const retentionSweepIntervalMs = 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

let lastRetentionSweepMs = 0;

function parseLogLevel(value?: string): LogLevel {
  switch ((value || "").trim().toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value!.trim().toLowerCase() as LogLevel;
    default:
      return "info";
  }
}

function parseBooleanFlag(value?: string): boolean {
  switch ((value || "").trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

function parsePositiveInteger(value?: string): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.floor(parsed);
  }
  return null;
}

function resolveLogToStdout(value?: string): boolean {
  if (value !== undefined) {
    return parseBooleanFlag(value);
  }

  return Boolean(process.stdout.isTTY);
}

function shouldLog(level: LogLevel): boolean {
  return levelWeight[level] >= levelWeight[getConfiguredLevel()];
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function sanitizeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "__rawLogString" in value &&
    value.__rawLogString === true &&
    "value" in value &&
    typeof value.value === "string"
  ) {
    return value.value;
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 1000) {
      return `${value.slice(0, 1000)}...<truncated>`;
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]),
  );
}

export function rawLogString(value: string): RawLogString {
  return {
    __rawLogString: true,
    value,
  };
}

export function includeContentInLogs(): boolean {
  return process.env.LOG_INCLUDE_CONTENT !== undefined
    ? parseBooleanFlag(process.env.LOG_INCLUDE_CONTENT)
    : readAppSettings().privacy.logIncludeContent;
}

export function includePromptInLogs(): boolean {
  return process.env.LOG_INCLUDE_PROMPT !== undefined
    ? parseBooleanFlag(process.env.LOG_INCLUDE_PROMPT)
    : readAppSettings().privacy.logIncludePrompt;
}

export function getLogDir(): string {
  return logDir;
}

function getConfiguredLevel(): LogLevel {
  return parseLogLevel(process.env.LOG_LEVEL || readAppSettings().privacy.logLevel);
}

function getConfiguredRetentionDays(): number {
  return parsePositiveInteger(process.env.LOG_RETENTION_DAYS) ?? readAppSettings().privacy.logRetentionDays;
}

/** 生成带本地时区偏移的 ISO 时间字符串，例如 2026-03-15T19:51:25.038+08:00 */
function formatLocalISOString(date: Date): string {
  const offset = -date.getTimezoneOffset(); // 分钟，东区为正
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offsetMinutes = String(absOffset % 60).padStart(2, "0");

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${sign}${offsetHours}:${offsetMinutes}`;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    ts: formatLocalISOString(new Date()),
    level,
    msg: message,
    ...(context ? { ctx: sanitizeValue(context) } : {}),
  };

  const line = JSON.stringify(payload);
  writeLogFile(line);

  if (!logToStdout) {
    return;
  }

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function writeLogFile(line: string): void {
  mkdirSync(logDir, { recursive: true });
  const now = new Date();
  sweepExpiredLogs(now);
  const currentLogDir = path.join(logDir, buildLogDayDirName(now));
  mkdirSync(currentLogDir, { recursive: true });
  const filePath = path.join(currentLogDir, buildLogFileName(now));
  appendFileSync(filePath, `${line}\n`, "utf8");
}

function sweepExpiredLogs(now: Date): void {
  const nowMs = now.getTime();
  if (nowMs - lastRetentionSweepMs < retentionSweepIntervalMs) {
    return;
  }
  lastRetentionSweepMs = nowMs;

  const cutoffMs = nowMs - getConfiguredRetentionDays() * dayMs;
  try {
    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      const entryPath = path.join(logDir, entry.name);
      if (entry.isDirectory()) {
        if (!isLogDayDirName(entry.name)) continue;
        sweepExpiredLogsInDir(entryPath, cutoffMs);
        removeDirIfEmpty(entryPath);
        continue;
      }
      if (entry.isFile()) removeExpiredLogFile(entryPath, entry.name, cutoffMs);
    }
  } catch {
    // Log cleanup must never prevent writing the current log line.
  }
}

function sweepExpiredLogsInDir(dir: string, cutoffMs: number): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      removeExpiredLogFile(path.join(dir, entry.name), entry.name, cutoffMs);
    }
  } catch {
    // Log cleanup must never prevent writing the current log line.
  }
}

function removeExpiredLogFile(filePath: string, fileName: string, cutoffMs: number): void {
  const logTimeMs = parseLogFileTimeMs(fileName);
  if (logTimeMs !== null && logTimeMs < cutoffMs) {
    rmSync(filePath, { force: true });
  }
}

function removeDirIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Log cleanup must never prevent writing the current log line.
  }
}

function parseLogFileTimeMs(fileName: string): number | null {
  const match = fileName.match(new RegExp(`^${escapeRegExp(logBaseName)}\\.(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})$`));
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) {
    return null;
  }
  return date.getTime();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLogFileName(date: Date): string {
  const bucketDate = new Date(date.getTime());
  bucketDate.setSeconds(0, 0);
  bucketDate.setMinutes(Math.floor(bucketDate.getMinutes() / 10) * 10);

  const day = buildLogDayDirName(bucketDate);
  const hour = String(bucketDate.getHours()).padStart(2, "0");
  const minute = String(bucketDate.getMinutes()).padStart(2, "0");

  return `${logBaseName}.${day}-${hour}${minute}`;
}

function buildLogDayDirName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function isLogDayDirName(value: string): boolean {
  return /^\d{8}$/.test(value);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    emit("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>) {
    emit("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>) {
    emit("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>) {
    emit("error", message, context);
  },
};
