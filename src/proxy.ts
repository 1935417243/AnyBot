import { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { readProxyConfig, getProxyUrl, type ProxyConfig } from "./web/proxy-config.js";
import { logger } from "./logger.js";

let currentProxyUrl: string | null = null;
let originalDispatcher: Dispatcher | null = null;

export function applyProxy(config?: ProxyConfig): void {
  const cfg = config ?? readProxyConfig();
  const proxyUrl = getProxyUrl(cfg);

  if (proxyUrl === currentProxyUrl) return;

  if (!proxyUrl) {
    if (originalDispatcher) {
      setGlobalDispatcher(originalDispatcher);
      logger.info("proxy.disabled");
    }
    currentProxyUrl = null;
    setProxyEnvVars(null);
    return;
  }

  if (!originalDispatcher) {
    originalDispatcher = getGlobalDispatcher();
  }

  try {
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    currentProxyUrl = proxyUrl;
    setProxyEnvVars(proxyUrl);
    logger.info("proxy.applied", { protocol: cfg.protocol, host: cfg.host, port: cfg.port });
  } catch (error) {
    logger.error("proxy.apply_failed", { error, proxyUrl });
    throw new Error(`代理配置无效: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setProxyEnvVars(proxyUrl: string | null): void {
  if (proxyUrl) {
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.http_proxy = proxyUrl;
    process.env.https_proxy = proxyUrl;
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
  }
}

export function getActiveProxyUrl(): string | null {
  return currentProxyUrl;
}
