import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataDir } from "./app-settings.js";

export function expandHomeDir(dir: string): string {
  if (dir === "~") return os.homedir();
  if (dir.startsWith("~/") || dir.startsWith("~\\")) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

export function getCodexHome(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return path.resolve(expandHomeDir(codexHome || path.join(os.homedir(), ".codex"))).normalize("NFC");
}

export function getCodexSkillsDir(): string {
  return path.join(getCodexHome(), "skills");
}

export function getCodexUserSkillsDir(): string {
  return path.resolve(path.join(os.homedir(), ".agents", "skills")).normalize("NFC");
}

export function getIsolatedCodexHome(): string {
  const dir = path.join(getDataDir(), "codex");
  mkdirSync(dir, { recursive: true });
  return dir;
}
