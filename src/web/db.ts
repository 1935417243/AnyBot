import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export type ChatSession = {
  id: string;
  title: string;
  sessionId: string | null;
  provider: string | null;
  source: string;
  chatId: string | null;
  projectId: string | null;
  messages: Array<{ id: number; role: "user" | "assistant"; content: string; createdAt: number; metadata?: string | null }>;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessage = ChatSession["messages"][number];
export type ChatSessionMetadata = Omit<ChatSession, "messages">;

export type SessionSummary = {
  id: string;
  title: string;
  provider: string | null;
  source: string;
  projectId: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
};

const dataDir = process.env.DATA_DIR || process.env.CODEX_DATA_DIR || path.join(process.cwd(), ".data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "chat.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    path       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '新对话',
    session_id TEXT,
    provider   TEXT,
    source     TEXT NOT NULL DEFAULT 'web',
    chat_id    TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
`);

try {
  db.exec(`ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN chat_id TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN provider TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
} catch (_) {}

db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_source_chat ON sessions(source, chat_id)`);;
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider)`);

const stmts = {
  listProjects: db.prepare(`
    SELECT id, name, path, created_at AS createdAt, updated_at AS updatedAt
    FROM projects
    ORDER BY updated_at DESC, name ASC
  `),

  getProject: db.prepare(`
    SELECT id, name, path, created_at AS createdAt, updated_at AS updatedAt
    FROM projects WHERE id = ?
  `),

  findProjectByPath: db.prepare(`
    SELECT id, name, path, created_at AS createdAt, updated_at AS updatedAt
    FROM projects WHERE path = ?
  `),

  insertProject: db.prepare(`
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (@id, @name, @path, @createdAt, @updatedAt)
  `),

  touchProject: db.prepare(`
    UPDATE projects SET updated_at = ? WHERE id = ?
  `),

  listSessions: db.prepare(`
    SELECT s.id, s.title, s.provider, s.source, s.project_id AS projectId,
           s.created_at AS createdAt,
           MAX(s.updated_at, COALESCE(MAX(m.created_at), s.updated_at)) AS updatedAt,
           COUNT(m.id) AS messageCount
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY updatedAt DESC, s.created_at DESC, s.id DESC
  `),

  getSession: db.prepare(`
    SELECT id, title, session_id AS sessionId, provider, source, chat_id AS chatId, project_id AS projectId,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sessions WHERE id = ?
  `),

  getMessages: db.prepare(`
    SELECT id, role, content, created_at AS createdAt, metadata FROM messages
    WHERE session_id = ? ORDER BY id ASC
  `),

  getMessagesPage: db.prepare(`
    SELECT id, role, content, createdAt, metadata FROM (
      SELECT id, role, content, created_at AS createdAt, metadata FROM messages
      WHERE session_id = ?
        AND (? IS NULL OR id < ?)
      ORDER BY id DESC
      LIMIT ?
    ) ORDER BY id ASC
  `),

  getMessageContent: db.prepare(`
    SELECT content FROM messages WHERE session_id = ? AND id = ?
  `),

  countMessagesBefore: db.prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE session_id = ?
      AND (? IS NULL OR id < ?)
  `),

  countMessages: db.prepare(`
    SELECT COUNT(*) AS count FROM messages WHERE session_id = ?
  `),

  insertSession: db.prepare(`
    INSERT INTO sessions (id, title, session_id, provider, source, chat_id, project_id, created_at, updated_at)
    VALUES (@id, @title, @sessionId, @provider, @source, @chatId, @projectId, @createdAt, @updatedAt)
  `),

  updateSession: db.prepare(`
    UPDATE sessions SET title = @title, session_id = @sessionId, provider = @provider, updated_at = @updatedAt
    WHERE id = @id
  `),

  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
  deleteAllSessions: db.prepare(`DELETE FROM sessions`),

  insertMessage: db.prepare(`
    INSERT INTO messages (session_id, role, content, metadata) VALUES (?, ?, ?, ?)
  `),

  findBySourceChat: db.prepare(`
    SELECT id, title, session_id AS sessionId, provider, source, chat_id AS chatId, project_id AS projectId,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sessions WHERE source = ? AND chat_id = ?
    ORDER BY updated_at DESC LIMIT 1
  `),

  detachChatId: db.prepare(`
    UPDATE sessions SET chat_id = NULL WHERE source = ? AND chat_id = ?
  `),

  detachAllChannelSessions: db.prepare(`
    UPDATE sessions SET chat_id = NULL WHERE source != 'web' AND chat_id IS NOT NULL
  `),
};

export function listProjects(): Project[] {
  return stmts.listProjects.all() as Project[];
}

export function getProject(id: string): Project | null {
  return (stmts.getProject.get(id) as Project | undefined) || null;
}

export function findProjectByPath(projectPath: string): Project | null {
  return (stmts.findProjectByPath.get(projectPath) as Project | undefined) || null;
}

export function createProject(project: Project): void {
  stmts.insertProject.run({
    id: project.id,
    name: project.name,
    path: project.path,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}

export function touchProject(id: string, updatedAt: number): void {
  stmts.touchProject.run(updatedAt, id);
}

export function listSessions(): SessionSummary[] {
  return stmts.listSessions.all() as SessionSummary[];
}

export function getSession(id: string): ChatSession | null {
  const row = stmts.getSession.get(id) as
    | {
        id: string;
        title: string;
        sessionId: string | null;
        provider: string | null;
        source: string;
        chatId: string | null;
        projectId: string | null;
        createdAt: number;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;

  const messages = stmts.getMessages.all(id) as Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
    metadata: string | null;
  }>;

  return { ...row, messages };
}

export function getSessionMetadata(id: string): ChatSessionMetadata | null {
  const row = stmts.getSession.get(id) as
    | ChatSessionMetadata
    | undefined;
  return row || null;
}

export function getMessagesPage(
  sessionId: string,
  opts: { beforeId?: number | null; limit?: number } = {},
): { messages: ChatMessage[]; hasMore: boolean } {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit || 40)));
  const beforeId = opts.beforeId || null;
  const messages = stmts.getMessagesPage.all(sessionId, beforeId, beforeId, limit) as ChatMessage[];
  const oldestId = messages[0]?.id ?? beforeId;
  const countRow = stmts.countMessagesBefore.get(sessionId, oldestId, oldestId) as { count: number };
  return {
    messages,
    hasMore: Number(countRow?.count || 0) > 0,
  };
}

export function getMessageContent(sessionId: string, messageId: number): string | null {
  const row = stmts.getMessageContent.get(sessionId, messageId) as { content: string } | undefined;
  return row?.content ?? null;
}

export function countMessages(sessionId: string): number {
  const row = stmts.countMessages.get(sessionId) as { count: number };
  return Number(row?.count || 0);
}

export function createSession(session: ChatSession): void {
  stmts.insertSession.run({
    id: session.id,
    title: session.title,
    sessionId: session.sessionId,
    provider: session.provider || null,
    source: session.source || "web",
    chatId: session.chatId || null,
    projectId: session.projectId || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

export function findSessionBySourceChat(
  source: string,
  chatId: string,
): ChatSession | null {
  const row = findSessionMetadataBySourceChat(source, chatId);
  if (!row) return null;
  const messages = stmts.getMessages.all(row.id) as Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
    metadata: string | null;
  }>;
  return { ...row, messages };
}

export function findSessionMetadataBySourceChat(
  source: string,
  chatId: string,
): ChatSessionMetadata | null {
  const row = stmts.findBySourceChat.get(source, chatId) as
    | ChatSessionMetadata
    | undefined;
  return row || null;
}

export function updateSession(session: {
  id: string;
  title: string;
  sessionId: string | null;
  provider: string | null;
  updatedAt: number;
}): void {
  stmts.updateSession.run({
    id: session.id,
    title: session.title,
    sessionId: session.sessionId,
    provider: session.provider,
    updatedAt: session.updatedAt,
  });
}

export function deleteSession(id: string): void {
  stmts.deleteSession.run(id);
}

export function deleteAllSessions(): void {
  stmts.deleteAllSessions.run();
}

export function addMessage(sessionId: string, role: "user" | "assistant", content: string, metadata?: string | null): number {
  const result = stmts.insertMessage.run(sessionId, role, content, metadata || null);
  return Number(result.lastInsertRowid);
}

export function detachChatId(source: string, chatId: string): void {
  stmts.detachChatId.run(source, chatId);
}

export function detachAllChannelSessions(): void {
  stmts.detachAllChannelSessions.run();
}

export function closeDb(): void {
  db.close();
}
