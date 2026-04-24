export type SessionStatus = "starting" | "running" | "stopped" | "errored";

export interface SessionInfo {
  id: string;
  name: string;
  workingDir: string;
  status: SessionStatus;
  error?: string;
  createdAt: number;
  unreadCount: number;
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
