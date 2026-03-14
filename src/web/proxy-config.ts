import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ProxyConfig {
  enabled: boolean;
  protocol: "http" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../.data/proxy.json");

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  protocol: "http",
  host: "127.0.0.1",
  port: 7890,
};

function ensureConfig(): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  }
}

export function readProxyConfig(): ProxyConfig {
  ensureConfig();
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as ProxyConfig;
}

export function writeProxyConfig(config: ProxyConfig): void {
  ensureConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getProxyUrl(config?: ProxyConfig): string | null {
  const cfg = config ?? readProxyConfig();
  if (!cfg.enabled || !cfg.host || !cfg.port) return null;

  const auth =
    cfg.username && cfg.password
      ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
      : "";
  return `${cfg.protocol}://${auth}${cfg.host}:${cfg.port}`;
}
