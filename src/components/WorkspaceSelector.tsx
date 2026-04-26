import { useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { open } from "@tauri-apps/plugin-dialog";

export function WorkspaceSelector() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const sessions = useSessionStore((s) => s.sessions);

  const [isOpen, setIsOpen] = useState(false);

  const workspaceList = Object.values(workspaces);

  function getWorkspaceCounts(wsId: string) {
    const wsSessions = Object.values(sessions).filter((s) => s.workspaceId === wsId);
    return {
      running: wsSessions.filter((s) => s.status === "running").length,
      errored: wsSessions.filter((s) => s.status === "errored" || s.status === "crashed").length,
    };
  }

  const activeName = activeWorkspaceId
    ? workspaces[activeWorkspaceId]?.name ?? "Unknown"
    : "All Sessions";
  const activeColor = activeWorkspaceId
    ? workspaces[activeWorkspaceId]?.color ?? "#6366f1"
    : undefined;

  async function handleCreate() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir) return;
    const name = (dir as string).split("/").pop() || "Workspace";
    await createWorkspace(name, dir as string);
    setIsOpen(false);
  }

  return (
    <div className="relative px-3 py-2 border-b border-[var(--border)]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 text-sm text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
      >
        {activeColor && (
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: activeColor }} />
        )}
        <span className="truncate font-medium">{activeName}</span>
        <span className="ml-auto text-xs text-[var(--text-secondary)]">▾</span>
      </button>

      {isOpen && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden">
          <button
            onClick={() => { setActiveWorkspace(null); setIsOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] transition-colors ${
              !activeWorkspaceId ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
            }`}
          >
            All Sessions
          </button>
          {workspaceList.map((ws) => {
            const counts = getWorkspaceCounts(ws.id);
            return (
              <button
                key={ws.id}
                onClick={() => { setActiveWorkspace(ws.id); setIsOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] transition-colors flex items-center gap-2 ${
                  activeWorkspaceId === ws.id ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                }`}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ws.color }} />
                <span className="truncate">{ws.name}</span>
                <span className="ml-auto flex gap-1 flex-shrink-0">
                  {counts.running > 0 && (
                    <span className="text-[10px] bg-green-400/20 text-green-400 rounded-full px-1.5">{counts.running}</span>
                  )}
                  {counts.errored > 0 && (
                    <span className="text-[10px] bg-red-400/20 text-red-400 rounded-full px-1.5">{counts.errored}</span>
                  )}
                </span>
              </button>
            );
          })}
          <div className="border-t border-[var(--border)]">
            <button
              onClick={handleCreate}
              className="w-full text-left px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              + New Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
