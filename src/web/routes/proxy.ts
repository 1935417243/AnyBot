import { Router } from "express";
import type { Request, Response } from "express";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { logger } from "../../logger.js";
import { applyProxy, isProxyFeatureEnabled } from "../../proxy.js";
import { getProxyUrl, readProxyConfig, writeProxyConfig, type ProxyConfig } from "../proxy-config.js";

export function createProxyRouter(): Router {
  const router = Router();

  router.get("/proxy", (_req: Request, res: Response) => {
    try {
      const config = readProxyConfig();
      res.json({
        ...config,
        enabled: isProxyFeatureEnabled() ? config.enabled : false,
        featureEnabled: isProxyFeatureEnabled(),
      });
    } catch (error) {
      res.status(500).json({ error: "读取代理配置失败" });
    }
  });

  router.put("/proxy", (req: Request, res: Response) => {
    try {
      if (!isProxyFeatureEnabled()) {
        applyProxy();
        res.json({
          ...readProxyConfig(),
          enabled: false,
          featureEnabled: false,
        });
        return;
      }

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
      res.json({ ...config, featureEnabled: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新代理配置失败";
      res.status(400).json({ error: msg });
    }
  });

  router.post("/proxy/test", async (req: Request, res: Response) => {
    if (!isProxyFeatureEnabled()) {
      res.json({ ok: false, error: "代理功能已暂时关闭" });
      return;
    }

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

  return router;
}
