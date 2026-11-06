import crypto from "node:crypto";
import { getConfiguredWebPort } from "../../app-settings.js";
import type { AppMcpServerConnection } from "../../providers/types.js";
import { getApiToken } from "../auth.js";

/** 内置 MCP 请求携带本次运行凭证的请求头（Node 中请求头名统一小写） */
export const AGENT_MCP_GRANT_HEADER = "x-anybot-run-grant";

/** 内置 MCP Server 挂载在 /api 下的路径 */
export const AGENT_MCP_ROUTE_PATH = "/agent-mcp";

/** 内置 MCP 工具执行时可用的本次运行上下文，用于给新建自动化填默认值 */
export interface AgentMcpRunContext {
  /** 发起本次运行的 AnyBot 会话 ID */
  sessionId: string;
  /** 会话来源：web 表示 WebUI，其它为频道类型（weixin、telegram 等） */
  source: string;
  /** 本次运行使用的 Provider 类型 */
  provider: string;
  /** 会话所属项目 ID，普通对话为 null */
  projectId: string | null;
}

/** 运行中的凭证 → 运行上下文；运行结束即撤销，凭证只在本次运行内有效 */
const activeGrants = new Map<string, AgentMcpRunContext>();

/** 为一次 Agent 运行签发内置 MCP 凭证 */
export function issueAgentMcpGrant(context: AgentMcpRunContext): string {
  const token = crypto.randomBytes(24).toString("hex");
  activeGrants.set(token, { ...context });
  return token;
}

/** 运行结束后撤销凭证，之后携带该凭证的工具调用都会被拒绝 */
export function revokeAgentMcpGrant(token: string): void {
  activeGrants.delete(token);
}

/** 按请求头中的凭证查找运行上下文；凭证缺失、已撤销或格式不对时返回 null */
export function resolveAgentMcpGrant(token: unknown): AgentMcpRunContext | null {
  if (typeof token !== "string" || !token) return null;
  return activeGrants.get(token) || null;
}

/** 构造注入给 Provider 的内置 MCP 连接信息：同时携带 API token（通过 apiGuard）和本次运行凭证 */
export function buildAppMcpServerConnection(grantToken: string): AppMcpServerConnection {
  return {
    url: `http://127.0.0.1:${getConfiguredWebPort()}/api${AGENT_MCP_ROUTE_PATH}`,
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      [AGENT_MCP_GRANT_HEADER]: grantToken,
    },
  };
}
