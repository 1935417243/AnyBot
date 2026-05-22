import { createProvider, getProvider, normalizeProviderType } from "../providers/index.js";
import * as db from "./db.js";
import { listSkillMentions } from "./skills.js";

export type WebSlashItemType = "provider-skill" | "provider-command" | "project";

export interface WebSlashItem {
  type: WebSlashItemType;
  id: string;
  name: string;
  description: string;
  source: string;
  provider?: string;
  path?: string;
  enabled?: boolean;
}

export interface WebSlashGroup {
  type: WebSlashItemType;
  title: string;
  provider?: string;
  items: WebSlashItem[];
}

export interface WebSlashItemsPayload {
  provider: string;
  groups: WebSlashGroup[];
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

function resolveSlashProviderType(providerType?: string): string {
  const requested = providerType?.trim();
  if (requested) return normalizeProviderType(requested);
  return getProvider().type;
}

function getProviderDisplayName(providerType: string): string {
  return PROVIDER_DISPLAY_NAMES[providerType] || providerType;
}

function listProviderSkillSlashItems(providerType: string): WebSlashItem[] {
  return listSkillMentions(providerType)
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      type: "provider-skill",
      id: skill.id,
      name: skill.name,
      description: skill.description || "",
      source: skill.source,
      provider: providerType,
      enabled: skill.enabled,
    }));
}

function listProviderCommandSlashItems(providerType: string): WebSlashItem[] {
  try {
    const provider = createProvider(providerType);
    return (provider.listSlashCommands?.() || []).map((command) => ({
      type: "provider-command",
      id: command.id,
      name: command.name,
      description: command.description || "",
      source: getProviderDisplayName(providerType),
      provider: providerType,
      enabled: true,
    }));
  } catch {
    return [];
  }
}

function listProjectSlashItems(): WebSlashItem[] {
  return db.listProjects()
    .filter((project) => project.id && project.name && project.path)
    .map((project) => ({
      type: "project",
      id: project.id,
      name: project.name,
      description: project.path,
      source: "项目",
      path: project.path,
    }));
}

export function listWebSlashItems(providerType?: string): WebSlashItemsPayload {
  const provider = resolveSlashProviderType(providerType);
  const providerName = getProviderDisplayName(provider);
  const providerSkills = listProviderSkillSlashItems(provider);
  const providerCommands = listProviderCommandSlashItems(provider);
  const projects = listProjectSlashItems();
  const groups: WebSlashGroup[] = [];

  if (providerSkills.length > 0) {
    groups.push({
      type: "provider-skill",
      title: `${providerName} 技能`,
      provider,
      items: providerSkills,
    });
  }

  if (providerCommands.length > 0) {
    groups.push({
      type: "provider-command",
      title: `${providerName} 命令`,
      provider,
      items: providerCommands,
    });
  }

  if (projects.length > 0) {
    groups.push({
      type: "project",
      title: "项目",
      items: projects,
    });
  }

  return { provider, groups };
}
