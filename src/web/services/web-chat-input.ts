import path from "node:path";
import * as db from "../db.js";
import { isImageFile } from "./files.js";
import { normalizeProjectPath } from "./projects.js";

export type ChatAttachment = { path: string; name: string };
export type ChatPromptSkill = { id?: string; name?: string };
export type ChatPromptProject = { id?: string; name?: string; path?: string };

function normalizeWebChatSkills(skills: ChatPromptSkill[] = []): Array<{ id?: string; name: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ id?: string; name: string }> = [];
  for (const skill of skills) {
    const name = String(skill?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push({
      ...(skill.id ? { id: String(skill.id) } : {}),
      name,
    });
    if (normalized.length >= 8) break;
  }
  return normalized;
}

function normalizeWebChatProjects(projects: ChatPromptProject[] = []): Array<{ id: string; name: string; path: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ id: string; name: string; path: string }> = [];

  for (const item of projects) {
    const id = String(item?.id || "").trim();
    const itemPath = String(item?.path || "").trim();
    let project: db.Project | null = id ? db.getProject(id) : null;
    if (!project && itemPath) {
      try {
        project = db.findProjectByPath(normalizeProjectPath(itemPath));
      } catch {
        project = null;
      }
    }
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    normalized.push({
      id: project.id,
      name: project.name,
      path: project.path,
    });
    if (normalized.length >= 12) break;
  }

  return normalized;
}

function getWebChatSelectionFallback(
  skills: Array<{ id?: string; name: string }>,
  projects: Array<{ id: string; name: string; path: string }>,
  options: { hasSessionProject?: boolean } = {},
): string {
  const parts: string[] = [];
  if (skills.length > 0) {
    parts.push(`使用技能：${skills.map((skill) => skill.name).join("、")}`);
  }
  if (projects.length > 0) {
    const projectLabel = options.hasSessionProject ? "额外项目" : "选择项目";
    parts.push(`${projectLabel}：${projects.map((project) => project.name).join("、")}`);
  }
  return parts.join("\n");
}

export function prepareWebChatInput(
  content?: string,
  attachments: ChatAttachment[] = [],
  skills: ChatPromptSkill[] = [],
  projects: ChatPromptProject[] = [],
  options: { sessionProjectId?: string | null } = {},
) {
  let userText = (content || "").trim();
  const imagePaths: string[] = [];
  const filePaths: ChatAttachment[] = [];
  const skillInfo = normalizeWebChatSkills(skills);
  const sessionProjectId = options.sessionProjectId || "";
  const projectInfo = normalizeWebChatProjects(projects)
    .filter((project) => project.id !== sessionProjectId);
  const promptParts: string[] = [];

  if (projectInfo.length > 0) {
    const projectList = projectInfo.map((project) => `- ${project.name}: ${project.path}`).join("\n");
    const projectTitle = sessionProjectId ? "本轮额外选择项目" : "本轮选择项目";
    promptParts.push(`${projectTitle}。处理文件时必须按项目名使用对应绝对路径：\n\n${projectList}`);
  }

  if (skillInfo.length > 0) {
    const skillList = skillInfo.map((skill) => `- ${skill.name}`).join("\n");
    promptParts.push(`用户本轮选择的技能：\n${skillList}`);
  }

  if (userText) {
    promptParts.push(`任务目标：\n${userText}`);
  }

  if (promptParts.length > 0) {
    userText = promptParts.join("\n\n");
  }

  for (const att of attachments) {
    if (isImageFile(att.name)) {
      imagePaths.push(att.path);
    } else {
      filePaths.push(att);
    }
  }

  if (filePaths.length > 0) {
    const fileList = filePaths.map((f) => `- ${f.name}: ${f.path}`).join("\n");
    userText = `${userText}\n\n用户附带了以下文件，请读取并处理：\n${fileList}`;
  }
  if (imagePaths.length > 0) {
    const imgList = imagePaths.map((p) => `- ${path.basename(p)}: ${p}`).join("\n");
    userText = `${userText}\n\n用户附带了以下图片：\n${imgList}`;
  }

  const attachmentInfo = attachments.map((a) => ({ name: a.name, path: a.path }));
  const metadata = {
    ...(attachmentInfo.length > 0 ? { attachments: attachmentInfo } : {}),
    ...(skillInfo.length > 0 ? { skills: skillInfo } : {}),
    ...(projectInfo.length > 0 ? { projects: projectInfo } : {}),
  };
  const selectionFallback = getWebChatSelectionFallback(skillInfo, projectInfo, {
    hasSessionProject: !!sessionProjectId,
  });
  const storedFallback = selectionFallback
    ? selectionFallback
    : "[附件]";
  return {
    userText,
    imagePaths,
    fileCount: filePaths.length,
    skillCount: skillInfo.length,
    projectCount: projectInfo.length,
    storedUserContent: content?.trim() || storedFallback,
    titleText: content?.trim() || (selectionFallback ? storedFallback : "文件分析"),
    userMetadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
  };
}
