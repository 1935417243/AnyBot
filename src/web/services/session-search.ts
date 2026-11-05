import * as db from "../db.js";

/** 搜索关键词最大字符数，超出部分截断 */
const MAX_KEYWORD_CHARS = 100;
/** 单次搜索最多返回的会话数 */
const MAX_RESULT_LIMIT = 50;
/** 片段中关键词之前保留的字符数 */
const SNIPPET_CHARS_BEFORE = 30;
/** 片段总字符数 */
const SNIPPET_CHARS = 120;

/** 会话搜索结果：会话摘要 + 标题是否命中 + 命中消息片段 */
export type SessionSearchResult = db.SessionSummary & {
  /** 标题是否包含关键词 */
  titleMatched: boolean;
  /** 最近一条命中消息中关键词附近的内容片段，消息未命中时为 null */
  snippet: string | null;
};

/** 转义 LIKE 通配符，配合 ESCAPE '\' 使用 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 只把 ASCII 字母转小写，与 SQLite lower() 和 LIKE 的大小写规则保持一致 */
function toAsciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

/** 读取命中消息片段：折叠空白，并在截断处补省略号 */
function buildMessageSnippet(messageId: number, needle: string): string | null {
  const row = db.getMessageSearchSnippet(messageId, needle, SNIPPET_CHARS_BEFORE, SNIPPET_CHARS);
  if (!row || !row.snippet) return null;
  const text = row.snippet.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const start = Math.max(1, Number(row.position || 0) - SNIPPET_CHARS_BEFORE);
  const prefix = start > 1 ? "…" : "";
  const suffix = start - 1 + SNIPPET_CHARS < Number(row.contentLength || 0) ? "…" : "";
  return `${prefix}${text}${suffix}`;
}

/** 按标题或消息内容搜索会话，关键词为空时返回空列表 */
export function searchSessions(keyword: string, limit: number): SessionSearchResult[] {
  const normalized = keyword.trim().slice(0, MAX_KEYWORD_CHARS);
  if (!normalized) return [];
  const safeLimit = Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(limit) || 1));
  const rows = db.searchSessionRows(`%${escapeLikePattern(normalized)}%`, safeLimit);
  const needle = toAsciiLowerCase(normalized);
  return rows.map(({ titleMatched, matchedMessageId, ...session }) => ({
    ...session,
    titleMatched: Boolean(titleMatched),
    snippet: matchedMessageId ? buildMessageSnippet(matchedMessageId, needle) : null,
  }));
}
