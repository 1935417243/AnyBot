export function getObjectStringValue(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  if (raw && typeof raw === "object") return getObjectStringValue(raw, "message");
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function getObjectArrayValue(value: unknown, key: string): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
