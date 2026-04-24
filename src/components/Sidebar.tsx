import { useSessionStore } from "../stores/sessionStore";
import { open } from "@tauri-apps/plugin-dialog";
import type { SessionStatus } from "../lib/types";

const statusColors: Record<SessionStatus, string> = {
  starting: "bg-yellow-400",
  running: "bg-green-400",
  stopped: "bg-gray-400",
  errored: "bg-red-400",
};

const statusLabels: Record<SessionStatus, string> = {
  starting: "Starting",
  running: "Running",
  stopped: "Stopped",
  errored: "Error",
};

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const stopSession = useSessionStore((s) => s.stopSession);

  const sessionList = Object.values(sessions).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

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
          className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
        >
          + New
        </button>
      </div>

      {/* Session List */}
      <nav className="flex-1 overflow-y-auto">
        {sessionList.length === 0 && (
          <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">
            No sessions yet. Click "+ New" to start.
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
              <span className="text-sm truncate text-[var(--text-primary)]">
                {session.name}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1 ml-4">
              <span className="text-xs text-[var(--text-secondary)] truncate">
                {session.workingDir}
              </span>
              {session.status === "running" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    stopSession(session.id);
                  }}
                  className="text-xs text-[var(--error)] hover:underline ml-2 flex-shrink-0"
                >
                  Stop
                </button>
              )}
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
