import { Router } from "express";
import type { Request, Response } from "express";
import { runCodex } from "../codex.js";
import type { SandboxMode } from "../types.js";
import { sandboxModes } from "../types.js";
import { buildSystemPrompt } from "../prompt.js";
import { logger } from "../logger.js";
import * as db from "./db.js";

const codexBin = process.env.CODEX_BIN || "codex";
const codexSandboxRaw = process.env.CODEX_SANDBOX || "read-only";
const codexModel = process.env.CODEX_MODEL;
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
        model: codexModel,
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
