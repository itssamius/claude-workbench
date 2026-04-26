import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { open } from "@tauri-apps/plugin-dialog";
import type { SessionStatus } from "../lib/types";
import { SessionSettingsModal } from "./SessionSettingsModal";

const statusColors: Record<SessionStatus, string> = {
  starting: "bg-yellow-400",
  running: "bg-green-400",
  stopped: "bg-gray-400",
  errored: "bg-red-400",
  crashed: "bg-orange-400",
};

const statusLabels: Record<SessionStatus, string> = {
  starting: "Starting",
  running: "Running",
  stopped: "Stopped",
  errored: "Error",
  crashed: "Crashed",
};

function InlineRename({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(value);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSave(name.trim() || value);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onSave(name.trim() || value)}
      className="text-sm bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--accent)] rounded px-1 w-full outline-none"
    />
  );
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const stopSession = useSessionStore((s) => s.stopSession);
  const restartSession = useSessionStore((s) => s.restartSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const removeSession = useSessionStore((s) => s.removeSession);

  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [settingsSessionId, setSettingsSessionId] = useState<string | null>(null);

  const sessionList = Object.values(sessions)
    .filter((s) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.workingDir.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  async function handleNewSession() {
    const dir = await open({ directory: true, multiple: false });
    if (dir) {
      await createSession(dir);
    }
  }

  return (
    <aside className="h-full flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)]">
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">
          Sessions
        </h1>
        <button
          onClick={handleNewSession}
          title="New session (⌘N)"
          className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
        >
          + New
        </button>
      </div>

      {/* Filter */}
      {Object.keys(sessions).length > 1 && (
        <div className="px-3 py-2 border-b border-[var(--border)]">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sessions..."
            className="w-full text-xs bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-secondary)]"
          />
        </div>
      )}

      {/* Session List */}
      <nav className="flex-1 overflow-y-auto">
        {sessionList.length === 0 && !filter && (
          <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">
            No sessions yet. Click "+ New" to start.
          </p>
        )}
        {sessionList.length === 0 && filter && (
          <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">
            No sessions match "{filter}"
          </p>
        )}
        {sessionList.map((session) => (
          <button
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors ${
              session.id === activeSessionId
                ? "bg-[var(--bg-surface)]"
                : "hover:bg-[var(--bg-surface)]/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[session.status]}`}
                title={statusLabels[session.status]}
              />
              {renamingId === session.id ? (
                <InlineRename
                  value={session.name}
                  onSave={(name) => {
                    renameSession(session.id, name);
                    setRenamingId(null);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <span
                  className="text-sm truncate text-[var(--text-primary)]"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(session.id);
                  }}
                  title="Double-click to rename"
                >
                  {session.name}
                </span>
              )}
              {/* Unread badge */}
              {session.unreadCount > 0 &&
                session.id !== activeSessionId && (
                  <span className="ml-auto flex-shrink-0 bg-[var(--accent)] text-[var(--bg-primary)] text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {session.unreadCount > 99 ? "99+" : session.unreadCount}
                  </span>
                )}
            </div>
            <div className="flex items-center justify-between mt-1 ml-4">
              <span className="text-xs text-[var(--text-secondary)] truncate">
                {session.workingDir}
              </span>
              {session.status === "crashed" && session.exitCode !== undefined && (
                <span className="text-xs text-[var(--error)]">
                  Exit code: {session.exitCode}
                </span>
              )}
              <div className="flex gap-2 ml-2 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsSessionId(session.id);
                  }}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  title="Session settings"
                >
                  ⚙
                </button>
                {(session.status === "stopped" ||
                  session.status === "errored" ||
                  session.status === "crashed") && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      restartSession(session.id);
                    }}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    Restart
                  </button>
                )}
                {session.status === "running" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      stopSession(session.id);
                    }}
                    className="text-xs text-[var(--error)] hover:underline"
                  >
                    Stop
                  </button>
                )}
                {(session.status === "stopped" ||
                  session.status === "errored" ||
                  session.status === "crashed") && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(session.id);
                    }}
                    className="text-xs text-[var(--text-secondary)] hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </button>
        ))}
      </nav>

      {/* Footer — session count */}
      {Object.keys(sessions).length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
          {Object.values(sessions).filter((s) => s.status === "running").length}{" "}
          running / {Object.keys(sessions).length} total
        </div>
      )}
      {settingsSessionId && (
        <SessionSettingsModal
          sessionId={settingsSessionId}
          onClose={() => setSettingsSessionId(null)}
        />
      )}
    </aside>
  );
}
