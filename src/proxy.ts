import { EnvHttpProxyAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { readProxyConfig, getProxyUrl, type ProxyConfig } from "./web/proxy-config.js";
import { logger } from "./logger.js";

// Dot-prefixed for correct subdomain matching in both undici and proxy-from-env (used by axios).
// e.g. ".feishu.cn" matches "open.feishu.cn", "bytedance.feishu.cn", etc.
const BYPASS_DOMAINS = [
  ".feishu.cn",
  ".larksuite.com",
  ".qq.com",
  ".weixin.qq.com",
  "localhost",
  "127.0.0.1",
  "::1",
];

const PROXY_FEATURE_ENABLED = false;

let currentProxyUrl: string | null = null;
let originalDispatcher: Dispatcher | null = null;

export function isProxyFeatureEnabled(): boolean {
  return PROXY_FEATURE_ENABLED;
}

export function applyProxy(config?: ProxyConfig): void {
  if (!PROXY_FEATURE_ENABLED) {
    if (originalDispatcher) {
      setGlobalDispatcher(originalDispatcher);
    }
    currentProxyUrl = null;
    setProxyEnvVars(null);
    logger.info("proxy.feature_disabled");
    return;
  }

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

  const noProxy = BYPASS_DOMAINS.join(",");

  try {
    const agent = new EnvHttpProxyAgent({
      httpProxy: proxyUrl,
      httpsProxy: proxyUrl,
      noProxy,
    });
    setGlobalDispatcher(agent);
    currentProxyUrl = proxyUrl;
    setProxyEnvVars(proxyUrl, noProxy);
    logger.info("proxy.applied", {
      protocol: cfg.protocol,
      host: cfg.host,
      port: cfg.port,
      noProxy,
    });
  } catch (error) {
    logger.error("proxy.apply_failed", { error, proxyUrl });
    throw new Error(`代理配置无效: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setProxyEnvVars(proxyUrl: string | null, noProxy?: string): void {
  if (proxyUrl) {
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.http_proxy = proxyUrl;
    process.env.https_proxy = proxyUrl;
    const np = noProxy ?? BYPASS_DOMAINS.join(",");
    process.env.NO_PROXY = np;
    process.env.no_proxy = np;
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  }
}

export function getActiveProxyUrl(): string | null {
  return currentProxyUrl;
}
