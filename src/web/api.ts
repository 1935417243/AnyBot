import { Router } from "express";
import type { Request, Response } from "express";
import { runCodex } from "../codex.js";
import type { SandboxMode } from "../types.js";
import { sandboxModes } from "../types.js";
import { buildSystemPrompt } from "../prompt.js";
import { logger } from "../logger.js";
import * as db from "./db.js";
import { readModelConfig, getCurrentModel, setCurrentModel } from "./model-config.js";
import {
  readChannelsConfig,
  updateChannelConfig,
  getRegisteredChannelTypes,
  channelManager,
} from "../channels/index.js";
import { listSkills, toggleSkill, deleteSkill, openSkillsFolder } from "./skills.js";

const codexBin = process.env.CODEX_BIN || "codex";
const codexSandboxRaw = process.env.CODEX_SANDBOX || "read-only";
const codexWorkdir = process.env.CODEX_WORKDIR || process.cwd();
const extraSystemPrompt = process.env.CODEX_SYSTEM_PROMPT;

const codexSandbox: SandboxMode = sandboxModes.includes(codexSandboxRaw as SandboxMode)
  ? (codexSandboxRaw as SandboxMode)
  : "read-only";

const outputContract = [
  "只回复当前这条用户消息。",
  "如果需要发送图片给用户，在回复中包含图片绝对路径或 Markdown 图片语法 ![描述](/绝对路径.png)。相对路径基于工作目录解析。",
  "如果需要发送非图片文件，每个文件单独一行，格式：FILE: /绝对路径/文件名.扩展名。",
].join("\n");

function getSystemPrompt(): string {
  return buildSystemPrompt({
    workdir: codexWorkdir,
    sandbox: codexSandbox,
    extraPrompt: extraSystemPrompt,
  });
}

function buildFirstTurnPrompt(userText: string): string {
  return `${getSystemPrompt()}

输出要求：
${outputContract}

用户消息：
${userText}`;
}

function buildResumePrompt(userText: string): string {
  return `${userText}

补充要求：
${outputContract}`;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTitle(text: string): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > 20 ? clean.slice(0, 20) + "…" : clean;
}

export function chatRouter(): Router {
  const router = Router();

  router.get("/sessions", (_req: Request, res: Response) => {
    const list = db.listSessions();
    res.json(list);
  });

  router.post("/sessions", (_req: Request, res: Response) => {
    const session: db.ChatSession = {
      id: generateId(),
      title: "新对话",
      sessionId: null,
      source: "web",
      chatId: null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.createSession(session);
    res.json({ id: session.id, title: session.title });
  });

  router.get("/sessions/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSession(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }
    res.json({
      id: session.id,
      title: session.title,
      messages: session.messages,
    });
  });

  router.delete("/sessions/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    db.deleteSession(id);
    res.json({ ok: true });
  });

  router.get("/model-config", (_req: Request, res: Response) => {
    try {
      res.json(readModelConfig());
    } catch (error) {
      res.status(500).json({ error: "读取模型配置失败" });
    }
  });

  router.put("/model-config", (req: Request, res: Response) => {
    const { modelId } = req.body as { modelId?: string };
    if (!modelId) {
      res.status(400).json({ error: "缺少 modelId" });
      return;
    }
    try {
      const config = setCurrentModel(modelId);
      logger.info("model.switched", { modelId });
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换模型失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/channels", (_req: Request, res: Response) => {
    try {
      const config = readChannelsConfig();
      const registered = getRegisteredChannelTypes();
      res.json({ registered, config });
    } catch (error) {
      res.status(500).json({ error: "读取频道配置失败" });
    }
  });

  router.put("/channels/:type", (req: Request, res: Response) => {
    const channelType = req.params.type as string;
    const registered = getRegisteredChannelTypes();
    if (!registered.includes(channelType)) {
      res.status(400).json({ error: `不支持的频道类型: ${channelType}` });
      return;
    }
    try {
      const config = updateChannelConfig(channelType, req.body);
      logger.info("channel.config.updated", { channelType });
      res.json(config);

      channelManager.restartChannel(channelType).catch((error) => {
        logger.error("channel.restart_after_save_failed", { channelType, error });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新频道配置失败";
      res.status(400).json({ error: msg });
    }
  });

  router.get("/skills", (_req: Request, res: Response) => {
    try {
      res.json(listSkills());
    } catch (error) {
      res.status(500).json({ error: "读取技能列表失败" });
    }
  });

  router.put("/skills/:id/toggle", (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id as string);
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "缺少 enabled 参数" });
      return;
    }
    try {
      toggleSkill(id, enabled);
      logger.info("skill.toggled", { id, enabled });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "切换技能状态失败" });
    }
  });

  router.delete("/skills/:id", (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id as string);
    const result = deleteSkill(id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    logger.info("skill.deleted", { id });
    res.json({ ok: true });
  });

  router.post("/skills/open-folder", (req: Request, res: Response) => {
    try {
      const { path: skillPath } = req.body as { path?: string };
      openSkillsFolder(skillPath);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开文件夹失败" });
    }
  });

  router.post("/sessions/:id/messages", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const session = db.getSession(id);
    if (!session) {
      res.status(404).json({ error: "会话不存在" });
      return;
    }

    const { content } = req.body as { content?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: "消息不能为空" });
      return;
    }

    const userText = content.trim();
    db.addMessage(id, "user", userText);

    if (session.messages.length <= 1) {
      session.title = generateTitle(userText);
    }

    const prompt = session.sessionId
      ? buildResumePrompt(userText)
      : buildFirstTurnPrompt(userText);

    try {
      logger.info("web.chat.start", {
        sessionId: session.id,
        codexSessionId: session.sessionId,
        userTextChars: userText.length,
      });

      const result = await runCodex({
        bin: codexBin,
        workdir: codexWorkdir,
        sandbox: codexSandbox,
        model: getCurrentModel(),
        prompt,
        sessionId: session.sessionId || undefined,
      });

      const codexSessionId = result.sessionId || session.sessionId;
      db.addMessage(id, "assistant", result.text);
      db.updateSession({
        id,
        title: session.title,
        sessionId: codexSessionId,
        updatedAt: Date.now(),
      });

      logger.info("web.chat.success", {
        sessionId: session.id,
        codexSessionId,
        replyChars: result.text.length,
      });

      res.json({
        role: "assistant",
        content: result.text,
        title: session.title,
      });
    } catch (error) {
      logger.error("web.chat.failed", {
        sessionId: session.id,
        error,
      });

      const errorMessage =
        error instanceof Error ? error.message : "处理消息时出错了，请稍后再试。";
      res.status(500).json({ error: errorMessage });
    }
  });

  return router;
}
