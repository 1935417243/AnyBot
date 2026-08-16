import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getDataDir } from "../app-settings.js";

// `/api` 鉴权与来源防护：服务只绑 127.0.0.1 挡不住 DNS rebinding 和本机其他进程,
// 因此要求所有 /api 请求携带启动时生成的随机 token(响应头或 ?token=),并校验
// Host/Origin/Sec-Fetch-Site,挡住浏览器重绑定和跨站请求。

let cachedToken: string | null = null;

export function getApiToken(): string {
  if (!cachedToken) {
    const fromEnv = process.env.ANYBOT_API_TOKEN?.trim();
    cachedToken = fromEnv || crypto.randomBytes(24).toString("hex");
  }
  return cachedToken;
}

// 供本机受信脚本(如调用 /api/send 的外部脚本)读取 token。
export function writeApiTokenFile(): void {
  try {
    const tokenPath = path.join(getDataDir(), "api-token");
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(tokenPath, getApiToken(), { mode: 0o600 });
  } catch {
    // token 文件只服务于本机脚本,写失败不影响 Web UI(走 HTML 注入)。
  }
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

// app 级:Host 头只允许回环地址,防 DNS rebinding(重绑定后 Host 是攻击者域名)。
export function hostGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isLocalHostHeader(req.headers.host)) {
    res.status(403).json({ error: "Forbidden: untrusted Host header" });
    return;
  }
  next();
}

// `/api/codex-openai/*` 供本机 Codex SDK/CLI 调用,SDK 端使用硬编码占位 key,
// 无法携带动态 token,故豁免 token 校验(Origin/Sec-Fetch-Site 校验仍然生效)。
function isCodexOpenAIPath(req: Request): boolean {
  return req.path === "/codex-openai" || req.path.startsWith("/codex-openai/");
}

function tokenMatches(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(getApiToken());
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// /api 级:校验 Origin/Sec-Fetch-Site(挡跨站请求) + Bearer/query token。
// 挂在 `app.use("/api", ...)` 之内,req.path 不含 "/api" 前缀。
export const apiGuard: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !LOCAL_ORIGIN_PATTERN.test(origin)) {
    res.status(403).json({ error: "Forbidden: untrusted Origin" });
    return;
  }

  const fetchSite = req.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite === "cross-site") {
    res.status(403).json({ error: "Forbidden: cross-site request" });
    return;
  }

  if (isCodexOpenAIPath(req)) {
    next();
    return;
  }

  const authorization = req.headers.authorization;
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  if (!tokenMatches(bearer ?? queryToken)) {
    res.status(401).json({ error: "Unauthorized: missing or invalid API token" });
    return;
  }
  next();
};
