import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionGranted = false;

export async function initNotifications(): Promise<void> {
  permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const result = await requestPermission();
    permissionGranted = result === "granted";
  }
}

export function notifySessionComplete(sessionName: string): void {
  if (!permissionGranted) return;
  sendNotification({
    title: "Session Complete",
    body: `"${sessionName}" has finished.`,
  });
}

export function notifySessionError(sessionName: string, error?: string): void {
  if (!permissionGranted) return;
  sendNotification({
    title: "Session Error",
    body: `"${sessionName}" encountered an error.${error ? ` ${error}` : ""}`,
  });
}

export function notifyRateLimit(sessionName: string): void {
  if (!permissionGranted) return;
  sendNotification({
    title: "Rate Limited",
    body: `"${sessionName}" is being rate limited.`,
  });
}
