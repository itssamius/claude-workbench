import { create } from "zustand";
import { Channel } from "@tauri-apps/api/core";
import type { SessionInfo, SessionStatus, PtyEvent } from "../lib/types";
import { spawnSession, stopSession as stopPty } from "../lib/tauri";

// Output listeners live outside Zustand to avoid re-renders on every byte
const outputListeners = new Map<string, (data: string) => void>();

export function subscribeToOutput(
  sessionId: string,
  listener: (data: string) => void,
) {
  outputListeners.set(sessionId, listener);
  return () => {
    outputListeners.delete(sessionId);
  };
}

interface SessionStore {
  sessions: Record<string, SessionInfo>;
  activeSessionId: string | null;

  createSession: (workingDir: string) => Promise<string>;
  stopSession: (id: string) => Promise<void>;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  setStatus: (id: string, status: SessionStatus, error?: string) => void;
  renameSession: (id: string, name: string) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

function dirName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  activeSessionId: null,

  createSession: async (workingDir: string) => {
    const id = generateId();
    const session: SessionInfo = {
      id,
      name: dirName(workingDir),
      workingDir,
      status: "starting",
      createdAt: Date.now(),
    };

    set((state) => ({
      sessions: { ...state.sessions, [id]: session },
      activeSessionId: id,
    }));

    const onEvent = new Channel<PtyEvent>();
    onEvent.onmessage = (msg) => {
      switch (msg.event) {
        case "output": {
          const listener = outputListeners.get(id);
          if (listener) listener(msg.data.data);
          break;
        }
        case "exit": {
          get().setStatus(id, "stopped");
          break;
        }
        case "error": {
          get().setStatus(id, "errored", msg.data.message);
          break;
        }
      }
    };

    try {
      await spawnSession(id, workingDir, onEvent);
      get().setStatus(id, "running");
    } catch (e) {
      get().setStatus(id, "errored", String(e));
    }

    return id;
  },

  stopSession: async (id: string) => {
    try {
      await stopPty(id);
      get().setStatus(id, "stopped");
    } catch (e) {
      console.error("Failed to stop session:", e);
    }
  },

  removeSession: (id: string) => {
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      const newActive =
        state.activeSessionId === id
          ? Object.keys(rest)[0] || null
          : state.activeSessionId;
      return { sessions: rest, activeSessionId: newActive };
    });
    outputListeners.delete(id);
  },

  setActiveSession: (id: string) => {
    set({ activeSessionId: id });
  },

  setStatus: (id: string, status: SessionStatus, error?: string) => {
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...session, status, error },
        },
      };
    });
  },

  renameSession: (id: string, name: string) => {
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...session, name },
        },
      };
    });
  },
}));
