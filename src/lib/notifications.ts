import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getNotificationsEnabled } from "../stores/workspaceStore";

let permissionGranted = false;

export async function initNotifications(): Promise<void> {
  permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const result = await requestPermission();
    permissionGranted = result === "granted";
  }
}

export function notifySessionComplete(sessionName: string, workspaceId?: string): void {
  if (!permissionGranted) return;
  if (!getNotificationsEnabled(workspaceId)) return;
  sendNotification({
    title: "Session Complete",
    body: `"${sessionName}" has finished.`,
  });
}

export function notifySessionError(sessionName: string, error?: string, workspaceId?: string): void {
  if (!permissionGranted) return;
  if (!getNotificationsEnabled(workspaceId)) return;
  sendNotification({
    title: "Session Error",
    body: `"${sessionName}" encountered an error.${error ? ` ${error}` : ""}`,
  });
}

export function notifyRateLimit(sessionName: string, workspaceId?: string): void {
  if (!permissionGranted) return;
  if (!getNotificationsEnabled(workspaceId)) return;
  sendNotification({
    title: "Rate Limited",
    body: `"${sessionName}" is being rate limited.`,
  });
}
