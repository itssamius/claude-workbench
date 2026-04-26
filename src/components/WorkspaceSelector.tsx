import { useState, useRef, useEffect } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { open } from "@tauri-apps/plugin-dialog";

export function WorkspaceSelector() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

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

  function handleSwitchWorkspace(wsId: string | null) {
    setActiveWorkspace(wsId);
    if (activeSessionId) {
      const currentSession = sessions[activeSessionId];
      if (currentSession) {
        const belongsToNew = wsId === null || currentSession.workspaceId === wsId;
        if (!belongsToNew) {
          const firstInWorkspace = Object.values(sessions).find((s) => s.workspaceId === wsId);
          if (firstInWorkspace) {
            setActiveSession(firstInWorkspace.id);
          } else {
            useSessionStore.setState({ activeSessionId: null });
          }
        }
      }
    }
    setIsOpen(false);
  }

  function handleDelete(e: React.MouseEvent, wsId: string) {
    e.stopPropagation();
    if (!confirm("Delete this workspace?")) return;
    deleteWorkspace(wsId);
  }

  function handleStartEdit(e: React.MouseEvent, ws: { id: string; name: string }) {
    e.stopPropagation();
    setEditingId(ws.id);
    setEditName(ws.name);
  }

  function handleFinishEdit(wsId: string) {
    if (editName.trim()) {
      updateWorkspace(wsId, { name: editName.trim() });
    }
    setEditingId(null);
  }

  function handleToggleNotifications(e: React.MouseEvent, ws: { id: string; notificationsEnabled?: boolean }) {
    e.stopPropagation();
    updateWorkspace(ws.id, { notificationsEnabled: !(ws.notificationsEnabled ?? true) });
  }

  return (
    <div ref={dropdownRef} className="relative px-3 py-2 border-b border-[var(--border)]">
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
            onClick={() => handleSwitchWorkspace(null)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] transition-colors ${
              !activeWorkspaceId ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
            }`}
          >
            All Sessions
          </button>
          {workspaceList.map((ws) => {
            const counts = getWorkspaceCounts(ws.id);
            const isEditing = editingId === ws.id;
            return (
              <div
                key={ws.id}
                onClick={() => { if (!isEditing) handleSwitchWorkspace(ws.id); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-surface)] transition-colors flex items-center gap-2 cursor-pointer ${
                  activeWorkspaceId === ws.id ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                }`}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ws.color }} />
                {isEditing ? (
                  <input
                    className="flex-1 min-w-0 bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm px-1 rounded border border-[var(--border)] outline-none"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleFinishEdit(ws.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleFinishEdit(ws.id); }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span className="truncate">{ws.name}</span>
                )}
                <span className="ml-auto flex gap-1 flex-shrink-0 items-center">
                  {counts.running > 0 && (
                    <span className="text-[10px] bg-green-400/20 text-green-400 rounded-full px-1.5">{counts.running}</span>
                  )}
                  {counts.errored > 0 && (
                    <span className="text-[10px] bg-red-400/20 text-red-400 rounded-full px-1.5">{counts.errored}</span>
                  )}
                  <button
                    onClick={(e) => handleToggleNotifications(e, ws)}
                    className={`text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${(ws.notificationsEnabled ?? true) ? "" : "opacity-40"}`}
                    title={`Notifications ${(ws.notificationsEnabled ?? true) ? "on" : "off"}`}
                  >
                    🔔
                  </button>
                  <button
                    onClick={(e) => handleStartEdit(e, ws)}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    title="Rename"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, ws.id)}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    title="Delete"
                  >
                    ✕
                  </button>
                </span>
              </div>
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
