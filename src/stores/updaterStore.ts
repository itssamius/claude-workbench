import { create } from "zustand";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdateStatus, UpdateInfo } from "../lib/types";

let pendingUpdate: Update | null = null;

interface UpdaterStore {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  error: string | null;

  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  status: "idle",
  updateInfo: null,
  downloadProgress: 0,
  error: null,

  checkForUpdate: async () => {
    set({ status: "checking" });
    try {
      const update = await check();
      if (update) {
        pendingUpdate = update;
        set({
          status: "available",
          updateInfo: { version: update.version, body: update.body ?? undefined },
        });
      } else {
        set({ status: "idle" });
      }
    } catch {
      set({ status: "idle" });
    }
  },

  downloadAndInstall: async () => {
    if (!pendingUpdate) return;
    set({ status: "downloading", downloadProgress: 0 });
    try {
      let downloaded = 0;
      let contentLength = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              set({ downloadProgress: Math.round((downloaded / contentLength) * 100) });
            }
            break;
          case "Finished":
            break;
        }
      });
      set({ status: "ready" });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  dismiss: () => {
    pendingUpdate = null;
    set({ status: "idle", updateInfo: null, downloadProgress: 0 });
  },
}));
