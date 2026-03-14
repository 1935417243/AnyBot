import { Router } from "express";
import type { Request, Response } from "express";
import { getProvider, getRegisteredProviderTypes } from "../providers/index.js";
import { logger } from "../logger.js";
import * as db from "./db.js";
import {
  readModelConfig,
  getCurrentModel,
  setCurrentModel,
  setCurrentProvider,
  getProviderTypes,
} from "./model-config.js";
import {
  readChannelsConfig,
  updateChannelConfig,
  getRegisteredChannelTypes,
  channelManager,
} from "../channels/index.js";
import { listSkills, toggleSkill, deleteSkill, openSkillsFolder } from "./skills.js";
import { readProxyConfig, writeProxyConfig, getProxyUrl, type ProxyConfig } from "./proxy-config.js";
import { applyProxy } from "../proxy.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  buildFirstTurnPrompt,
  buildResumePrompt,
  generateId,
  generateTitle,
  getWorkdir,
  getSandbox,
} from "../shared.js";

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

  // --- Model & Provider config ---

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

  router.get("/providers", (_req: Request, res: Response) => {
    try {
      const providers = getProviderTypes();
      const current = getProvider().type;
      res.json({ current, providers });
    } catch (error) {
      res.status(500).json({ error: "读取 Provider 列表失败" });
    }
  });

  router.put("/providers/current", (req: Request, res: Response) => {
    const { provider } = req.body as { provider?: string };
    if (!provider) {
      res.status(400).json({ error: "缺少 provider" });
      return;
    }
    try {
      const config = setCurrentProvider(provider);
      logger.info("provider.switched", { provider });
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "切换 Provider 失败";
      res.status(400).json({ error: msg });
    }
  });

  // --- Channels ---

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

  // --- Skills ---

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
      const skillPath = req.body?.path as string | undefined;
      openSkillsFolder(skillPath);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "打开文件夹失败" });
    }
  });

  // --- Proxy ---

  router.get("/proxy", (_req: Request, res: Response) => {
    try {
      res.json(readProxyConfig());
    } catch (error) {
      res.status(500).json({ error: "读取代理配置失败" });
    }
  });

  router.put("/proxy", (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<ProxyConfig>;
      const current = readProxyConfig();
      const config: ProxyConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        protocol: body.protocol === "socks5" ? "socks5" : "http",
        host: typeof body.host === "string" ? body.host.trim() : current.host,
        port: typeof body.port === "number" && body.port > 0 ? body.port : current.port,
        username: typeof body.username === "string" ? body.username : current.username,
        password: typeof body.password === "string" ? body.password : current.password,
      };
      writeProxyConfig(config);
      applyProxy(config);
      logger.info("proxy.config.updated", {
        enabled: config.enabled,
        protocol: config.protocol,
        host: config.host,
        port: config.port,
      });
      res.json(config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新代理配置失败";
      res.status(400).json({ error: msg });
    }
  });

  router.post("/proxy/test", async (req: Request, res: Response) => {
    const body = req.body as Partial<ProxyConfig> | undefined;
    const testConfig: ProxyConfig = {
      enabled: true,
      protocol: body?.protocol === "socks5" ? "socks5" : "http",
      host: (typeof body?.host === "string" && body.host.trim()) || "127.0.0.1",
      port: (typeof body?.port === "number" && body.port > 0) ? body.port : 7890,
    };
    if (body?.username) testConfig.username = body.username;
    if (body?.password) testConfig.password = body.password;

    const proxyUrl = getProxyUrl(testConfig);
    if (!proxyUrl) {
      res.json({ ok: false, error: "代理地址无效" });
      return;
    }

    let agent: ProxyAgent | null = null;
    try {
      agent = new ProxyAgent(proxyUrl);
      const testUrl = "https://www.google.com/generate_204";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const start = Date.now();
      const response = await undiciFetch(testUrl, {
        dispatcher: agent,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latency = Date.now() - start;
      res.json({ ok: response.ok || response.status === 204, latency, status: response.status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "连接失败";
      res.json({ ok: false, error: msg });
    } finally {
      agent?.close();
    }
  });

  // --- Chat messages ---

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
      const provider = getProvider();
      logger.info("web.chat.start", {
        sessionId: session.id,
        providerSessionId: session.sessionId,
        provider: provider.type,
        userTextChars: userText.length,
      });

      const result = await provider.run({
        workdir: getWorkdir(),
        sandbox: getSandbox(),
        model: getCurrentModel(),
        prompt,
        sessionId: session.sessionId || undefined,
      });

      const providerSessionId = result.sessionId || session.sessionId;
      db.addMessage(id, "assistant", result.text);
      db.updateSession({
        id,
        title: session.title,
        sessionId: providerSessionId,
        updatedAt: Date.now(),
      });

      logger.info("web.chat.success", {
        sessionId: session.id,
        providerSessionId,
        provider: provider.type,
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
