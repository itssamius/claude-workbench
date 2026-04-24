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

// Matches Rust PtyEvent tagged enum (serde tag = "event", content = "data")
export type PtyEvent =
  | { event: "output"; data: { data: string } }
  | { event: "exit"; data: { code: number | null } }
  | { event: "error"; data: { message: string } };
