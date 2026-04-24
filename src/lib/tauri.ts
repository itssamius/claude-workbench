import { invoke, Channel } from "@tauri-apps/api/core";
import type { PtyEvent } from "./types";

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

export { Channel };
