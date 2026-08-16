import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatRouter } from "./api.js";
import { apiGuard, getApiToken, hostGuard } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN_PLACEHOLDER = "</head>";

export function createApp(): express.Application {
  const app = express();

  const publicDir = path.join(__dirname, "public");
  const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

  const serveIndex: express.RequestHandler = (_req, res) => {
    // 每次请求注入当前 token,后端重启 token 轮换后刷新页面即可取到新值。
    const injected = indexHtml.replace(
      TOKEN_PLACEHOLDER,
      `<script>window.__ANYBOT_API_TOKEN__=${JSON.stringify(getApiToken())};</script>${TOKEN_PLACEHOLDER}`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(injected);
  };

  app.use(hostGuard);
  app.use(express.json({ limit: "50mb" }));
  app.use("/api", apiGuard, chatRouter());
  // /api 下未匹配的路径返回 404 JSON,不要落到 SPA fallback 返回 HTML。
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });
  app.use(express.static(publicDir, { index: false }));

  app.get("/", serveIndex);
  app.get("/{*path}", serveIndex);

  return app;
}
