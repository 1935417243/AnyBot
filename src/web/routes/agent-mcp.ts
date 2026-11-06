import { Router } from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "../../logger.js";
import { createAgentMcpServer } from "../services/agent-mcp.js";
import {
  AGENT_MCP_GRANT_HEADER,
  AGENT_MCP_ROUTE_PATH,
  resolveAgentMcpGrant,
} from "../services/agent-mcp-grants.js";

/** JSON-RPC 错误码：运行凭证无效（实现自定义错误段） */
const JSON_RPC_INVALID_GRANT = -32001;
/** JSON-RPC 错误码：服务端内部错误 */
const JSON_RPC_INTERNAL_ERROR = -32603;
/** JSON-RPC 错误码：方法不可用（无状态模式不支持 SSE 推送与会话删除） */
const JSON_RPC_METHOD_NOT_ALLOWED = -32000;

/** 构造 JSON-RPC 错误响应体 */
function jsonRpcError(code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

/** 无状态模式下拒绝 GET（SSE 推送）与 DELETE（结束会话） */
function rejectUnsupportedMethod(_req: Request, res: Response): void {
  res.status(405).set("Allow", "POST").json(jsonRpcError(JSON_RPC_METHOD_NOT_ALLOWED, "Method not allowed"));
}

/** AnyBot 内置 MCP Server（Streamable HTTP，无状态），只服务于 ChatRunner 注入给 Provider 的本次运行 */
export function createAgentMcpRouter(): Router {
  const router = Router();

  router.post(AGENT_MCP_ROUTE_PATH, async (req: Request, res: Response) => {
    const context = resolveAgentMcpGrant(req.headers[AGENT_MCP_GRANT_HEADER]);
    if (!context) {
      res.status(401).json(jsonRpcError(JSON_RPC_INVALID_GRANT, "运行凭证无效或本次运行已结束"));
      return;
    }

    const server = createAgentMcpServer(context);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("agent_mcp.request_failed", { sessionId: context.sessionId, error });
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(JSON_RPC_INTERNAL_ERROR, "内置 MCP 请求处理失败"));
      }
    }
  });

  router.get(AGENT_MCP_ROUTE_PATH, rejectUnsupportedMethod);
  router.delete(AGENT_MCP_ROUTE_PATH, rejectUnsupportedMethod);

  return router;
}
