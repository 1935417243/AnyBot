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

export type SessionListCursor = {
  updatedAt: number;
  createdAt: number;
  id: string;
};

export type SessionListPageOptions = {
  limit?: number;
  cursor?: SessionListCursor | null;
  projectId?: string | null;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
};

export type AutomationRow = {
  id: string;
  name: string;
  prompt: string;
  enabled: number;
  provider: string;
  modelId: string | null;
  projectId: string | null;
  channelType: string;
  skillsJson: string;
  scheduleJson: string;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AutomationRunRow = {
  id: string;
  automationId: string;
  sessionId: string | null;
  status: string;
  deliveryStatus: string;
  output: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
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
    message_count INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS automations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    provider      TEXT NOT NULL,
    model_id      TEXT,
    project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
    channel_type  TEXT NOT NULL,
    skills_json   TEXT NOT NULL DEFAULT '[]',
    schedule_json TEXT NOT NULL,
    next_run_at   INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automation_runs (
    id              TEXT PRIMARY KEY,
    automation_id   TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    status          TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'none',
    output          TEXT,
    error           TEXT,
    started_at      INTEGER,
    finished_at     INTEGER,
    created_at      INTEGER NOT NULL
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
let didAddSessionMessageCount = false;
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0`);
  didAddSessionMessageCount = true;
} catch (_) {}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
} catch (_) {}

if (didAddSessionMessageCount) {
  db.exec(`
    UPDATE sessions
    SET message_count = (
          SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
        ),
        updated_at = CASE
          WHEN COALESCE((
            SELECT MAX(created_at) FROM messages WHERE messages.session_id = sessions.id
          ), updated_at) > updated_at
          THEN COALESCE((
            SELECT MAX(created_at) FROM messages WHERE messages.session_id = sessions.id
          ), updated_at)
          ELSE updated_at
        END
  `);
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_source_chat ON sessions(source, chat_id)`);;
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_list ON sessions(updated_at DESC, created_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project_list ON sessions(project_id, updated_at DESC, created_at DESC, id DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_automations_enabled_next ON automations(enabled, next_run_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_created ON automation_runs(automation_id, created_at DESC)`);

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

  deleteProject: db.prepare(`
    DELETE FROM projects WHERE id = ?
  `),

  listSessions: db.prepare(`
    SELECT id, title, provider, source, project_id AS projectId,
           message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt
    FROM sessions
    ORDER BY updated_at DESC, created_at DESC, id DESC
  `),

  listSessionsPage: db.prepare(`
    SELECT id, title, provider, source, project_id AS projectId,
           message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt
    FROM sessions
    WHERE (
      @cursorUpdatedAt IS NULL
      OR updated_at < @cursorUpdatedAt
      OR (updated_at = @cursorUpdatedAt AND created_at < @cursorCreatedAt)
      OR (updated_at = @cursorUpdatedAt AND created_at = @cursorCreatedAt AND id < @cursorId)
    )
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT @limit
  `),

  listGlobalSessionsPage: db.prepare(`
    SELECT id, title, provider, source, project_id AS projectId,
           message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt
    FROM sessions
    WHERE project_id IS NULL
      AND (
        @cursorUpdatedAt IS NULL
        OR updated_at < @cursorUpdatedAt
        OR (updated_at = @cursorUpdatedAt AND created_at < @cursorCreatedAt)
        OR (updated_at = @cursorUpdatedAt AND created_at = @cursorCreatedAt AND id < @cursorId)
      )
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT @limit
  `),

  listProjectSessionsPage: db.prepare(`
    SELECT id, title, provider, source, project_id AS projectId,
           message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt
    FROM sessions
    WHERE project_id = @projectId
      AND (
        @cursorUpdatedAt IS NULL
        OR updated_at < @cursorUpdatedAt
        OR (updated_at = @cursorUpdatedAt AND created_at < @cursorCreatedAt)
        OR (updated_at = @cursorUpdatedAt AND created_at = @cursorCreatedAt AND id < @cursorId)
      )
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT @limit
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
    INSERT INTO sessions (id, title, session_id, provider, source, chat_id, project_id, message_count, created_at, updated_at)
    VALUES (@id, @title, @sessionId, @provider, @source, @chatId, @projectId, @messageCount, @createdAt, @updatedAt)
  `),

  updateSession: db.prepare(`
    UPDATE sessions SET title = @title, session_id = @sessionId, provider = @provider, updated_at = @updatedAt
    WHERE id = @id
  `),

  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
  deleteProjectSessions: db.prepare(`DELETE FROM sessions WHERE project_id = ?`),
  deleteAllSessions: db.prepare(`DELETE FROM sessions`),

  insertMessage: db.prepare(`
    INSERT INTO messages (session_id, role, content, metadata) VALUES (?, ?, ?, ?)
  `),

  incrementSessionMessageCount: db.prepare(`
    UPDATE sessions SET message_count = message_count + 1 WHERE id = ?
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

  listAutomations: db.prepare(`
    SELECT id, name, prompt, enabled, provider, model_id AS modelId, project_id AS projectId,
           channel_type AS channelType, skills_json AS skillsJson, schedule_json AS scheduleJson,
           next_run_at AS nextRunAt, created_at AS createdAt, updated_at AS updatedAt
    FROM automations
    ORDER BY updated_at DESC, created_at DESC
  `),

  getAutomation: db.prepare(`
    SELECT id, name, prompt, enabled, provider, model_id AS modelId, project_id AS projectId,
           channel_type AS channelType, skills_json AS skillsJson, schedule_json AS scheduleJson,
           next_run_at AS nextRunAt, created_at AS createdAt, updated_at AS updatedAt
    FROM automations WHERE id = ?
  `),

  insertAutomation: db.prepare(`
    INSERT INTO automations (
      id, name, prompt, enabled, provider, model_id, project_id, channel_type,
      skills_json, schedule_json, next_run_at, created_at, updated_at
    ) VALUES (
      @id, @name, @prompt, @enabled, @provider, @modelId, @projectId, @channelType,
      @skillsJson, @scheduleJson, @nextRunAt, @createdAt, @updatedAt
    )
  `),

  updateAutomation: db.prepare(`
    UPDATE automations
    SET name = @name,
        prompt = @prompt,
        enabled = @enabled,
        provider = @provider,
        model_id = @modelId,
        project_id = @projectId,
        channel_type = @channelType,
        skills_json = @skillsJson,
        schedule_json = @scheduleJson,
        next_run_at = @nextRunAt,
        updated_at = @updatedAt
    WHERE id = @id
  `),

  deleteAutomation: db.prepare(`DELETE FROM automations WHERE id = ?`),

  listDueAutomations: db.prepare(`
    SELECT id, name, prompt, enabled, provider, model_id AS modelId, project_id AS projectId,
           channel_type AS channelType, skills_json AS skillsJson, schedule_json AS scheduleJson,
           next_run_at AS nextRunAt, created_at AS createdAt, updated_at AS updatedAt
    FROM automations
    WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC, updated_at ASC
  `),

  getNextAutomation: db.prepare(`
    SELECT id, name, prompt, enabled, provider, model_id AS modelId, project_id AS projectId,
           channel_type AS channelType, skills_json AS skillsJson, schedule_json AS scheduleJson,
           next_run_at AS nextRunAt, created_at AS createdAt, updated_at AS updatedAt
    FROM automations
    WHERE enabled = 1 AND next_run_at IS NOT NULL
    ORDER BY next_run_at ASC, updated_at ASC
    LIMIT 1
  `),

  insertAutomationRun: db.prepare(`
    INSERT INTO automation_runs (
      id, automation_id, session_id, status, delivery_status, output, error,
      started_at, finished_at, created_at
    ) VALUES (
      @id, @automationId, @sessionId, @status, @deliveryStatus, @output, @error,
      @startedAt, @finishedAt, @createdAt
    )
  `),

  updateAutomationRun: db.prepare(`
    UPDATE automation_runs
    SET session_id = @sessionId,
        status = @status,
        delivery_status = @deliveryStatus,
        output = @output,
        error = @error,
        started_at = @startedAt,
        finished_at = @finishedAt
    WHERE id = @id
  `),

  listAutomationRuns: db.prepare(`
    SELECT id, automation_id AS automationId, session_id AS sessionId, status, delivery_status AS deliveryStatus,
           output, error, started_at AS startedAt, finished_at AS finishedAt, created_at AS createdAt
    FROM automation_runs
    WHERE automation_id = ?
    ORDER BY created_at DESC
    LIMIT ?
    OFFSET ?
  `),

  countAutomationRuns: db.prepare(`
    SELECT COUNT(*) AS count
    FROM automation_runs
    WHERE automation_id = ?
  `),

  deleteOldAutomationRuns: db.prepare(`
    DELETE FROM automation_runs
    WHERE automation_id = ?
      AND id NOT IN (
        SELECT id FROM automation_runs
        WHERE automation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
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

export function deleteProject(id: string): boolean {
  const deleteProjectWithSessions = db.transaction((projectId: string) => {
    stmts.deleteProjectSessions.run(projectId);
    return stmts.deleteProject.run(projectId);
  });
  const result = deleteProjectWithSessions(id);
  return result.changes > 0;
}

export function listSessions(): SessionSummary[] {
  return stmts.listSessions.all() as SessionSummary[];
}

export function listSessionsPage(
  opts: SessionListPageOptions = {},
): { items: SessionSummary[]; hasMore: boolean } {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit || 40)));
  const cursor = opts.cursor || null;
  const params = {
    cursorUpdatedAt: cursor?.updatedAt ?? null,
    cursorCreatedAt: cursor?.createdAt ?? null,
    cursorId: cursor?.id ?? null,
    limit: limit + 1,
    projectId: opts.projectId || null,
  };
  const stmt = Object.prototype.hasOwnProperty.call(opts, "projectId")
    ? opts.projectId
      ? stmts.listProjectSessionsPage
      : stmts.listGlobalSessionsPage
    : stmts.listSessionsPage;
  const rows = stmt.all(params) as SessionSummary[];
  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
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
    messageCount: session.messages.length,
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
  stmts.incrementSessionMessageCount.run(sessionId);
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

export function listAutomationRows(): AutomationRow[] {
  return stmts.listAutomations.all() as AutomationRow[];
}

export function getAutomationRow(id: string): AutomationRow | null {
  return (stmts.getAutomation.get(id) as AutomationRow | undefined) || null;
}

export function createAutomationRow(row: AutomationRow): void {
  stmts.insertAutomation.run(row);
}

export function updateAutomationRow(row: AutomationRow): boolean {
  const result = stmts.updateAutomation.run(row);
  return result.changes > 0;
}

export function deleteAutomationRow(id: string): boolean {
  const result = stmts.deleteAutomation.run(id);
  return result.changes > 0;
}

export function listDueAutomationRows(now: number): AutomationRow[] {
  return stmts.listDueAutomations.all(now) as AutomationRow[];
}

export function getNextAutomationRow(): AutomationRow | null {
  return (stmts.getNextAutomation.get() as AutomationRow | undefined) || null;
}

export function createAutomationRunRow(row: AutomationRunRow): void {
  stmts.insertAutomationRun.run(row);
}

export function updateAutomationRunRow(row: AutomationRunRow): boolean {
  const result = stmts.updateAutomationRun.run(row);
  return result.changes > 0;
}

export function listAutomationRunRows(automationId: string, limit = 50, offset = 0): AutomationRunRow[] {
  return stmts.listAutomationRuns.all(
    automationId,
    Math.max(1, Math.floor(limit)),
    Math.max(0, Math.floor(offset)),
  ) as AutomationRunRow[];
}

export function countAutomationRunRows(automationId: string): number {
  const row = stmts.countAutomationRuns.get(automationId) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

export function deleteOldAutomationRunRows(automationId: string, keep = 100): void {
  stmts.deleteOldAutomationRuns.run(automationId, automationId, Math.max(1, Math.floor(keep)));
}
