import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export type ChatSession = {
  id: string;
  title: string;
  sessionId: string | null;
  source: string;
  chatId: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string; metadata?: string | null }>;
  createdAt: number;
  updatedAt: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  source: string;
  messageCount: number;
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
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '新对话',
    session_id TEXT,
    source     TEXT NOT NULL DEFAULT 'web',
    chat_id    TEXT,
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
  db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
} catch (_) {}

db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_source_chat ON sessions(source, chat_id)`);;

const stmts = {
  listSessions: db.prepare(`
    SELECT s.id, s.title, s.source, s.created_at AS createdAt, s.updated_at AS updatedAt,
           COUNT(m.id) AS messageCount
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
  `),

  getSession: db.prepare(`
    SELECT id, title, session_id AS sessionId, source, chat_id AS chatId,
           created_at AS createdAt, updated_at AS updatedAt
    FROM sessions WHERE id = ?
  `),

  getMessages: db.prepare(`
    SELECT role, content, metadata FROM messages
    WHERE session_id = ? ORDER BY id ASC
  `),

  insertSession: db.prepare(`
    INSERT INTO sessions (id, title, session_id, source, chat_id, created_at, updated_at)
    VALUES (@id, @title, @sessionId, @source, @chatId, @createdAt, @updatedAt)
  `),

  updateSession: db.prepare(`
    UPDATE sessions SET title = @title, session_id = @sessionId, updated_at = @updatedAt
    WHERE id = @id
  `),

  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),

  insertMessage: db.prepare(`
    INSERT INTO messages (session_id, role, content, metadata) VALUES (?, ?, ?, ?)
  `),

  findBySourceChat: db.prepare(`
    SELECT id, title, session_id AS sessionId, source, chat_id AS chatId,
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

export function listSessions(): SessionSummary[] {
  return stmts.listSessions.all() as SessionSummary[];
}

export function getSession(id: string): ChatSession | null {
  const row = stmts.getSession.get(id) as
    | {
        id: string;
        title: string;
        sessionId: string | null;
        source: string;
        chatId: string | null;
        createdAt: number;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;

  const messages = stmts.getMessages.all(id) as Array<{
    role: "user" | "assistant";
    content: string;
    metadata: string | null;
  }>;

  return { ...row, messages };
}

export function createSession(session: ChatSession): void {
  stmts.insertSession.run({
    id: session.id,
    title: session.title,
    sessionId: session.sessionId,
    source: session.source || "web",
    chatId: session.chatId || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

export function findSessionBySourceChat(
  source: string,
  chatId: string,
): ChatSession | null {
  const row = stmts.findBySourceChat.get(source, chatId) as
    | {
        id: string;
        title: string;
        sessionId: string | null;
        source: string;
        chatId: string | null;
        createdAt: number;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;
  const messages = stmts.getMessages.all(row.id) as Array<{
    role: "user" | "assistant";
    content: string;
    metadata: string | null;
  }>;
  return { ...row, messages };
}

export function updateSession(session: {
  id: string;
  title: string;
  sessionId: string | null;
  updatedAt: number;
}): void {
  stmts.updateSession.run({
    id: session.id,
    title: session.title,
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
  });
}

export function deleteSession(id: string): void {
  stmts.deleteSession.run(id);
}

export function addMessage(sessionId: string, role: "user" | "assistant", content: string, metadata?: string | null): void {
  stmts.insertMessage.run(sessionId, role, content, metadata || null);
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
