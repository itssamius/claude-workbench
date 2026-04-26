import { create } from "zustand";
import type { WorkspaceInfo } from "../lib/types";
import {
  dbSaveWorkspace,
  dbLoadAllWorkspaces,
  dbDeleteWorkspace,
  dbAssignSessionWorkspace,
} from "../lib/tauri";
import { useSessionStore } from "./sessionStore";

interface WorkspaceStore {
  workspaces: Record<string, WorkspaceInfo>;
  activeWorkspaceId: string | null;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, rootDir: string, color?: string) => Promise<string>;
  updateWorkspace: (id: string, updates: Partial<Pick<WorkspaceInfo, "name" | "color">>) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspaces: {},
  activeWorkspaceId: null,

  loadWorkspaces: async () => {
    const workspaces = await dbLoadAllWorkspaces();
    const map: Record<string, WorkspaceInfo> = {};
    for (const w of workspaces) map[w.id] = w;
    set({ workspaces: map });
  },

  createWorkspace: async (name: string, rootDir: string, color?: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const workspace: WorkspaceInfo = {
      id,
      name,
      rootDir,
      color: color ?? "#6366f1",
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ workspaces: { ...s.workspaces, [id]: workspace } }));
    await dbSaveWorkspace(workspace);

    // Auto-assign existing sessions whose workingDir starts with rootDir
    const sessions = useSessionStore.getState().sessions;
    for (const session of Object.values(sessions)) {
      if (session.workingDir.startsWith(rootDir) && !session.workspaceId) {
        await dbAssignSessionWorkspace(session.id, id);
        useSessionStore.setState((s) => ({
          sessions: {
            ...s.sessions,
            [session.id]: { ...s.sessions[session.id], workspaceId: id },
          },
        }));
      }
    }

    return id;
  },

  updateWorkspace: (id: string, updates: Partial<Pick<WorkspaceInfo, "name" | "color">>) => {
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      const updated = { ...ws, ...updates, updatedAt: Date.now() };
      dbSaveWorkspace(updated).catch(console.error);
      return { workspaces: { ...s.workspaces, [id]: updated } };
    });
  },

  deleteWorkspace: (id: string) => {
    set((s) => {
      const { [id]: _, ...rest } = s.workspaces;
      return {
        workspaces: rest,
        activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
      };
    });
    dbDeleteWorkspace(id).catch(console.error);
  },

  setActiveWorkspace: (id: string | null) => {
    set({ activeWorkspaceId: id });
  },
}));
