export type SessionStatus = "starting" | "running" | "stopped" | "errored" | "crashed";

export interface SessionInfo {
  id: string;
  name: string;
  workingDir: string;
  status: SessionStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
  unreadCount: number;
  exitCode?: number;
  envVars?: Record<string, string>;
  workspaceId?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootDir: string;
  color: string;
  notificationsEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface FileChangeEvent {
  path: string;
  sessionId: string;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent?: string; // for diff view
}

// Matches Rust PtyEvent tagged enum (serde tag = "event", content = "data")
export type PtyEvent =
  | { event: "output"; data: { data: string } }
  | { event: "exit"; data: { code: number | null } }
  | { event: "error"; data: { message: string } };

export interface OutputChunk {
  id: number;
  session_id: string;
  chunk_data: string;
  sequence_num: number;
  created_at: number;
}

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";
export interface UpdateInfo {
  version: string;
  body?: string;
}
