import { create } from "zustand";
import { Channel } from "@tauri-apps/api/core";
import type { SessionInfo, SessionStatus, PtyEvent } from "../lib/types";
import {
  spawnSession,
  stopSession as stopPty,
  dbSaveSession,
  dbLoadAllSessions,
  dbDeleteSession,
  dbSaveOutputChunk,
  dbLoadOutputChunks,
} from "../lib/tauri";

// Output buffer per session — stores raw terminal data for replay on switch
const MAX_BUFFER_SIZE = 500_000; // ~500KB per session
const outputBuffers = new Map<string, string[]>();
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

export function getOutputBuffer(sessionId: string): string[] {
  return outputBuffers.get(sessionId) || [];
}

function appendToBuffer(sessionId: string, data: string) {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = [];
    outputBuffers.set(sessionId, buf);
  }
  buf.push(data);
  // Trim if buffer gets too large — drop oldest entries
  let totalSize = 0;
  for (const chunk of buf) totalSize += chunk.length;
  while (totalSize > MAX_BUFFER_SIZE && buf.length > 1) {
    const removed = buf.shift()!;
    totalSize -= removed.length;
  }
  batchWriter.add(sessionId, data);
}

class BatchWriter {
  private pending = new Map<string, { data: string; seqNum: number }[]>();
  private seqCounters = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL = 1000;
  private readonly FLUSH_THRESHOLD = 100;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  add(sessionId: string, data: string) {
    let queue = this.pending.get(sessionId);
    if (!queue) {
      queue = [];
      this.pending.set(sessionId, queue);
    }
    const seqNum = (this.seqCounters.get(sessionId) ?? 0) + 1;
    this.seqCounters.set(sessionId, seqNum);
    queue.push({ data, seqNum });

    if (queue.length >= this.FLUSH_THRESHOLD) {
      this.flushSession(sessionId);
    }
  }

  private flush() {
    for (const sessionId of this.pending.keys()) {
      this.flushSession(sessionId);
    }
  }

  private flushSession(sessionId: string) {
    const queue = this.pending.get(sessionId);
    if (!queue || queue.length === 0) return;
    const toWrite = queue.splice(0);
    for (const chunk of toWrite) {
      dbSaveOutputChunk(sessionId, chunk.data, chunk.seqNum).catch(console.error);
    }
  }

  removeSession(sessionId: string) {
    this.pending.delete(sessionId);
    this.seqCounters.delete(sessionId);
  }
}

const batchWriter = new BatchWriter();
batchWriter.start();

interface SessionStore {
  sessions: Record<string, SessionInfo>;
  activeSessionId: string | null;

  createSession: (workingDir: string) => Promise<string>;
  stopSession: (id: string) => Promise<void>;
  restartSession: (id: string) => Promise<void>;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  setStatus: (id: string, status: SessionStatus, error?: string) => void;
  renameSession: (id: string, name: string) => void;
  clearUnread: (id: string) => void;
  loadSessions: () => Promise<void>;
  setEnvVars: (id: string, vars: Record<string, string>) => void;
  loadSessionOutput: (id: string) => Promise<void>;
}

function generateId(): string {
  return crypto.randomUUID();
}

function dirName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function setupChannel(id: string, get: () => SessionStore): Channel<PtyEvent> {
  const onEvent = new Channel<PtyEvent>();
  onEvent.onmessage = (msg) => {
    switch (msg.event) {
      case "output": {
        appendToBuffer(id, msg.data.data);
        const listener = outputListeners.get(id);
        if (listener) {
          listener(msg.data.data);
        }
        // Track unread if this session is not active
        const state = get();
        if (state.activeSessionId !== id) {
          const session = state.sessions[id];
          if (session) {
            get().setStatus(id, session.status);
            // Increment unread
            const current = state.sessions[id];
            if (current) {
              useSessionStore.setState((s) => ({
                sessions: {
                  ...s.sessions,
                  [id]: {
                    ...s.sessions[id],
                    unreadCount: (s.sessions[id]?.unreadCount || 0) + 1,
                  },
                },
              }));
            }
          }
        }
        break;
      }
      case "exit": {
        const code = msg.data.code;
        const status = code !== null && code !== 0 ? "crashed" : "stopped";
        const session = get().sessions[id];
        if (session) {
          const updated = { ...session, status, exitCode: code ?? undefined, updatedAt: Date.now() } as SessionInfo;
          useSessionStore.setState((s) => ({
            sessions: { ...s.sessions, [id]: updated },
          }));
          dbSaveSession({ ...updated, unreadCount: 0 } as SessionInfo).catch(console.error);
        }
        break;
      }
      case "error": {
        get().setStatus(id, "errored", msg.data.message);
        break;
      }
    }
  };
  return onEvent;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  activeSessionId: null,

  createSession: async (workingDir: string) => {
    const id = generateId();
    const now = Date.now();
    const session: SessionInfo = {
      id,
      name: dirName(workingDir),
      workingDir,
      status: "starting",
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
    };

    set((state) => ({
      sessions: { ...state.sessions, [id]: session },
      activeSessionId: id,
    }));

    dbSaveSession(session).catch(console.error);

    // Clear any stale buffer
    outputBuffers.set(id, []);

    const onEvent = setupChannel(id, get);

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

  restartSession: async (id: string) => {
    const session = get().sessions[id];
    if (!session) return;

    // Stop existing if still running
    if (session.status === "running") {
      await stopPty(id).catch(() => {});
    }

    // Clear buffer for fresh start
    outputBuffers.set(id, []);

    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: { ...state.sessions[id], status: "starting", error: undefined, exitCode: undefined, updatedAt: Date.now() },
      },
    }));

    const onEvent = setupChannel(id, get);

    try {
      await spawnSession(id, session.workingDir, onEvent, session.envVars);
      get().setStatus(id, "running");
    } catch (e) {
      get().setStatus(id, "errored", String(e));
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
    outputBuffers.delete(id);
    dbDeleteSession(id).catch(console.error);
    batchWriter.removeSession(id);
  },

  setActiveSession: (id: string) => {
    set((state) => ({
      activeSessionId: id,
      sessions: {
        ...state.sessions,
        [id]: { ...state.sessions[id], unreadCount: 0 },
      },
    }));
  },

  setStatus: (id: string, status: SessionStatus, error?: string) => {
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      const updated = { ...session, status, error, updatedAt: Date.now() };
      dbSaveSession(updated).catch(console.error);
      return {
        sessions: {
          ...state.sessions,
          [id]: updated,
        },
      };
    });
  },

  renameSession: (id: string, name: string) => {
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      const updated = { ...session, name, updatedAt: Date.now() };
      dbSaveSession(updated).catch(console.error);
      return {
        sessions: {
          ...state.sessions,
          [id]: updated,
        },
      };
    });
  },

  clearUnread: (id: string) => {
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: { ...session, unreadCount: 0 },
        },
      };
    });
  },

  loadSessions: async () => {
    const sessions = await dbLoadAllSessions();
    const sessionMap: Record<string, SessionInfo> = {};
    for (const s of sessions) {
      // Any session marked "running" or "starting" is stale — app just started
      if (s.status === "running" || s.status === "starting") {
        s.status = "crashed";
        s.error = "Session was running when app closed";
        s.updatedAt = Date.now();
        dbSaveSession(s).catch(console.error);
      }
      sessionMap[s.id] = s;
    }
    set({ sessions: sessionMap });
  },

  setEnvVars: (id: string, vars: Record<string, string>) => {
    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      const updated = { ...session, envVars: vars, updatedAt: Date.now() };
      dbSaveSession(updated).catch(console.error);
      return {
        sessions: { ...state.sessions, [id]: updated },
      };
    });
  },

  loadSessionOutput: async (id: string) => {
    const buf = outputBuffers.get(id);
    if (buf && buf.length > 0) return; // already have in-memory data
    const chunks = await dbLoadOutputChunks(id, 1000, 0);
    if (chunks.length > 0) {
      const buffer = chunks.map((c) => c.chunk_data);
      outputBuffers.set(id, buffer);
    }
  },
}));
