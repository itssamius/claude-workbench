import { invoke, Channel } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { PtyEvent, FileEntry, SessionInfo, OutputChunk, WorkspaceInfo } from "./types";

export function spawnSession(
  sessionId: string,
  workingDir: string,
  onEvent: Channel<PtyEvent>,
  envVars?: Record<string, string>,
) {
  return invoke("spawn_session", { sessionId, workingDir, envVars: envVars ?? null, onEvent });
}

export function sendInput(sessionId: string, data: string) {
  return invoke("send_input", { sessionId, data });
}

export function stopSession(sessionId: string) {
  return invoke("stop_session", { sessionId });
}

export function resizeSession(sessionId: string, rows: number, cols: number) {
  return invoke("resize_session", { sessionId, rows, cols });
}

export function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke("list_directory", { path });
}

export function readFile(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export function watchDirectory(sessionId: string, path: string) {
  return invoke("watch_directory", { sessionId, path });
}

export function unwatchDirectory(sessionId: string) {
  return invoke("unwatch_directory", { sessionId });
}

// --- Database query wrappers ---

let dbInstance: Database | null = null;

async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load("sqlite:claude-window.db");
  }
  return dbInstance;
}

export async function dbSaveSession(session: SessionInfo): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO sessions (id, name, working_dir, status, error, env_vars, created_at, updated_at, workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      session.id,
      session.name,
      session.workingDir,
      session.status,
      session.error ?? null,
      JSON.stringify(session.envVars ?? {}),
      session.createdAt,
      session.updatedAt ?? Date.now(),
      session.workspaceId ?? null,
    ],
  );
}

export async function dbLoadAllSessions(): Promise<SessionInfo[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string;
    name: string;
    working_dir: string;
    status: string;
    error: string | null;
    env_vars: string;
    created_at: number;
    updated_at: number;
    workspace_id: string | null;
  }>>("SELECT * FROM sessions ORDER BY created_at DESC");

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    workingDir: row.working_dir,
    status: row.status as SessionInfo["status"],
    error: row.error ?? undefined,
    envVars: JSON.parse(row.env_vars || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unreadCount: 0,
    workspaceId: row.workspace_id ?? undefined,
  }));
}

export async function dbDeleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM output_chunks WHERE session_id = $1", [id]);
  await db.execute("DELETE FROM sessions WHERE id = $1", [id]);
}

export async function dbSaveOutputChunk(
  sessionId: string,
  data: string,
  seqNum: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO output_chunks (session_id, chunk_data, sequence_num, created_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, data, seqNum, Date.now()],
  );
}

export async function dbLoadOutputChunks(
  sessionId: string,
  limit: number,
  offset: number,
): Promise<OutputChunk[]> {
  const db = await getDb();
  return db.select<OutputChunk[]>(
    `SELECT * FROM output_chunks WHERE session_id = $1
     ORDER BY sequence_num ASC LIMIT $2 OFFSET $3`,
    [sessionId, limit, offset],
  );
}

export async function dbSaveWorkspace(workspace: WorkspaceInfo): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO workspaces (id, name, root_dir, color, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspace.id, workspace.name, workspace.rootDir, workspace.color, workspace.createdAt, workspace.updatedAt],
  );
}

export async function dbLoadAllWorkspaces(): Promise<WorkspaceInfo[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string;
    name: string;
    root_dir: string;
    color: string;
    created_at: number;
    updated_at: number;
  }>>("SELECT * FROM workspaces ORDER BY created_at DESC");
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    rootDir: row.root_dir,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function dbDeleteWorkspace(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM workspaces WHERE id = $1", [id]);
}

export async function dbAssignSessionWorkspace(sessionId: string, workspaceId: string | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sessions SET workspace_id = $1 WHERE id = $2", [workspaceId, sessionId]);
}

export async function dbLoadSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function dbSaveSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
    [key, value],
  );
}

export function checkClaudeVersion(): Promise<string> {
  return invoke("check_claude_version");
}

export { Channel };
