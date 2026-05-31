import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { getProvider, normalizeProviderType } from "../providers/index.js";
import { getClaudeSkillsDir } from "../claude-config.js";
import { getCodexHome, getCodexSkillsDir, getCodexUserSkillsDir } from "../codex-config.js";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  fullPath: string;
  source: string;
  enabled: boolean;
  content: string;
}

export type SkillMentionInfo = Pick<SkillInfo, "id" | "name" | "description" | "source" | "enabled">;

interface SkillSource {
  label: string;
  dir: string;
}

interface ScannedSkill {
  name: string;
  skillPath: string;
  enabled: boolean;
}

const SKILL_FILE = "SKILL.md";
const DISABLED_SKILL_FILE = "SKILL.md.disabled";

const PROVIDER_SKILL_DIRS: Record<string, () => SkillSource[]> = {
  codex: () => {
    return [
      { label: "Codex 用户技能", dir: getCodexUserSkillsDir() },
      { label: "Codex 配置技能", dir: getCodexSkillsDir() },
    ];
  },
  "claude-code": () => {
    return [{ label: "Claude Code 技能", dir: getClaudeSkillsDir() }];
  },
};

function resolveSkillProviderType(providerType?: string): string {
  const requested = providerType?.trim();
  if (requested) return normalizeProviderType(requested);
  return getProvider().type;
}

function getConfiguredSkillSources(providerType?: string): SkillSource[] {
  const resolvedProviderType = resolveSkillProviderType(providerType);
  const factory = PROVIDER_SKILL_DIRS[resolvedProviderType];
  return factory ? factory() : [];
}

function ensureSkillSourceDir(source: SkillSource): boolean {
  try {
    fs.mkdirSync(source.dir, { recursive: true });
    return fs.statSync(source.dir).isDirectory();
  } catch {
    return false;
  }
}

function getSkillSources(providerType?: string): SkillSource[] {
  return getConfiguredSkillSources(providerType).filter(ensureSkillSourceDir);
}

function getDisabledSkillsPath(): string {
  const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.join(process.cwd(), ".data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "disabled-skills.json");
}

function readDisabledSkills(): Set<string> {
  try {
    const raw = fs.readFileSync(getDisabledSkillsPath(), "utf-8");
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeDisabledSkills(disabled: Set<string>): void {
  fs.writeFileSync(getDisabledSkillsPath(), JSON.stringify([...disabled], null, 2), "utf-8");
}

function parseSkillMd(content: string): { name: string; description: string } {
  const result = { name: "", description: "" };
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return result;

  const fm = fmMatch[1];
  const nameMatch = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);

  if (nameMatch) result.name = nameMatch[1].trim();
  if (descMatch) result.description = descMatch[1].trim();

  return result;
}

function readSkillFrontmatter(skillPath: string): string {
  const fd = fs.openSync(skillPath, "r");
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}

function isDirectoryLike(dir: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;

  try {
    return fs.statSync(path.join(dir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

function scanSkillDir(dir: string): ScannedSkill[] {
  const results: ScannedSkill[] = [];

  function scan(currentDir: string): void {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!isDirectoryLike(currentDir, entry)) continue;
        const subDir = path.join(currentDir, entry.name);
        const skillMd = path.join(subDir, SKILL_FILE);
        const disabledSkillMd = path.join(subDir, DISABLED_SKILL_FILE);
        if (fs.existsSync(skillMd)) {
          results.push({ name: entry.name, skillPath: skillMd, enabled: true });
        } else if (fs.existsSync(disabledSkillMd)) {
          results.push({ name: entry.name, skillPath: disabledSkillMd, enabled: false });
        } else if (entry.name.startsWith(".")) {
          scan(subDir);
        }
      }
    } catch {
      // dir not readable
    }
  }

  scan(dir);
  return results;
}

function syncPersistedDisabledState(id: string, item: ScannedSkill, disabled: Set<string>): void {
  if (!item.enabled || !disabled.has(id)) return;

  const skillDir = path.dirname(item.skillPath);
  const disabledPath = path.join(skillDir, DISABLED_SKILL_FILE);
  try {
    if (!fs.existsSync(disabledPath)) {
      fs.renameSync(item.skillPath, disabledPath);
      item.skillPath = disabledPath;
      item.enabled = false;
    }
  } catch {
    // Keep reporting the actual file state if migration cannot be applied.
  }
}

export function listSkills(
  providerType?: string,
): { skills: SkillInfo[]; sources: Array<{ label: string; dir: string; count: number }> } {
  const disabled = readDisabledSkills();
  const sources = getSkillSources(providerType);
  const skills: SkillInfo[] = [];
  const sourceStats: Array<{ label: string; dir: string; count: number }> = [];

  for (const source of sources) {
    const found = scanSkillDir(source.dir);
    sourceStats.push({ label: source.label, dir: source.dir, count: found.length });

    for (const item of found) {
      const id = `${source.label}::${item.name}`;
      syncPersistedDisabledState(id, item, disabled);

      const content = fs.readFileSync(item.skillPath, "utf-8");
      const meta = parseSkillMd(content);

      skills.push({
        id,
        name: meta.name || item.name,
        description: meta.description || "",
        fullPath: item.skillPath,
        source: source.label,
        enabled: item.enabled,
        content,
      });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, sources: sourceStats };
}

export function listSkillMentions(providerType?: string): SkillMentionInfo[] {
  const disabled = readDisabledSkills();
  const sources = getSkillSources(providerType);
  const skills: SkillMentionInfo[] = [];

  for (const source of sources) {
    const found = scanSkillDir(source.dir);
    for (const item of found) {
      const id = `${source.label}::${item.name}`;
      syncPersistedDisabledState(id, item, disabled);

      const meta = parseSkillMd(readSkillFrontmatter(item.skillPath));
      skills.push({
        id,
        name: meta.name || item.name,
        description: meta.description || "",
        source: source.label,
        enabled: item.enabled,
      });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function toggleSkill(id: string, enabled: boolean, providerType?: string): { ok: boolean; error?: string } {
  const { skills } = listSkills(providerType);
  const skill = skills.find((s) => s.id === id);
  if (!skill) return { ok: false, error: "技能不存在" };
  if (skill.enabled === enabled) return { ok: true };

  const skillDir = path.dirname(skill.fullPath);
  const enabledPath = path.join(skillDir, SKILL_FILE);
  const disabledPath = path.join(skillDir, DISABLED_SKILL_FILE);

  try {
    if (enabled) {
      if (!fs.existsSync(disabledPath)) return { ok: false, error: "禁用状态文件不存在" };
      if (fs.existsSync(enabledPath)) return { ok: false, error: "启用状态文件已存在" };
      fs.renameSync(disabledPath, enabledPath);
    } else {
      if (!fs.existsSync(enabledPath)) return { ok: false, error: "启用状态文件不存在" };
      if (fs.existsSync(disabledPath)) return { ok: false, error: "禁用状态文件已存在" };
      fs.renameSync(enabledPath, disabledPath);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "切换失败" };
  }

  const disabled = readDisabledSkills();
  if (enabled) {
    disabled.delete(id);
  } else {
    disabled.add(id);
  }
  writeDisabledSkills(disabled);
  return { ok: true };
}

export function deleteSkill(id: string, providerType?: string): { ok: boolean; error?: string } {
  const { skills } = listSkills(providerType);
  const skill = skills.find((s) => s.id === id);
  if (!skill) return { ok: false, error: "技能不存在" };

  const skillDir = path.dirname(skill.fullPath);
  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    const disabled = readDisabledSkills();
    disabled.delete(id);
    writeDisabledSkills(disabled);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "删除失败" };
  }
}

function openDirectory(dir: string): void {
  const platform = os.platform();
  if (platform === "darwin") {
    spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "win32") {
    spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("sh", [
      "-c",
      "nautilus \"$1\" 2>/dev/null || thunar \"$1\" 2>/dev/null || dolphin \"$1\" 2>/dev/null || xdg-open \"$1\"",
      "sh",
      dir,
    ], { detached: true, stdio: "ignore" }).unref();
  }
}

export function openSkillsFolder(skillPath?: string, providerType?: string): void {
  if (skillPath) {
    openDirectory(path.dirname(skillPath));
    return;
  }

  const baseDir =
    getSkillSources(providerType)[0]?.dir ||
    getConfiguredSkillSources(providerType)[0]?.dir ||
    (providerType ? "" : path.join(getCodexHome(), "skills"));
  if (!baseDir) return;

  const dirs = new Set<string>();

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(baseDir, entry.name);
      if (entry.name.startsWith(".")) {
        try {
          const inner = fs.readdirSync(sub, { withFileTypes: true });
          if (
            inner.some(
              (e) =>
                isDirectoryLike(sub, e) &&
                (fs.existsSync(path.join(sub, e.name, SKILL_FILE)) ||
                  fs.existsSync(path.join(sub, e.name, DISABLED_SKILL_FILE))),
            )
          ) {
            dirs.add(sub);
          }
        } catch {}
      } else if (fs.existsSync(path.join(sub, SKILL_FILE)) || fs.existsSync(path.join(sub, DISABLED_SKILL_FILE))) {
        dirs.add(baseDir);
      }
    }
  } catch {}

  if (dirs.size === 0) dirs.add(baseDir);

  for (const d of dirs) {
    openDirectory(d);
  }
}
