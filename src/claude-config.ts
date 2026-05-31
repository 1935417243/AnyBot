import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataDir } from "./app-settings.js";

export function expandHomeDir(dir: string): string {
  if (dir === "~") return os.homedir();
  if (dir.startsWith("~/") || dir.startsWith("~\\")) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

export function getClaudeConfigDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return path.resolve(expandHomeDir(configDir || path.join(os.homedir(), ".claude"))).normalize("NFC");
}

export function getClaudeSkillsDir(): string {
  return path.join(getClaudeConfigDir(), "skills");
}

export function getIsolatedClaudeConfigDir(): string {
  const dir = path.join(getDataDir(), "claude-code");
  mkdirSync(dir, { recursive: true });
  return dir;
}
