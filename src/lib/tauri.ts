import { invoke, Channel } from "@tauri-apps/api/core";
import type { PtyEvent, FileEntry } from "./types";

export function spawnSession(
  sessionId: string,
  workingDir: string,
  onEvent: Channel<PtyEvent>,
) {
  return invoke("spawn_session", { sessionId, workingDir, onEvent });
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

export { Channel };
