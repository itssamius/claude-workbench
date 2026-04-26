import { useEffect, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { TerminalPanel } from "./TerminalPanel";
import { CodeViewer } from "./CodeViewer";
import { useSessionStore } from "../stores/sessionStore";
import { useShortcuts } from "../hooks/useShortcuts";
import type { Shortcut } from "../hooks/useShortcuts";
import { open } from "@tauri-apps/plugin-dialog";

const resizeHandleClass =
  "w-[3px] bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-col-resize";

export function Layout() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = useSessionStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null,
  );
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const stopSession = useSessionStore((s) => s.stopSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const loadSessions = useSessionStore((s) => s.loadSessions);

  // Load persisted sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Get sorted session list for Cmd+1-9 switching
  const sortedSessionIds = useMemo(() => {
    return Object.values(sessions)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => s.id);
  }, [sessions]);

  const shortcuts: Shortcut[] = useMemo(() => {
    const list: Shortcut[] = [
      {
        id: "new-session",
        key: "n",
        modifiers: ["meta"],
        description: "New session",
        action: async () => {
          const dir = await open({ directory: true, multiple: false });
          if (dir) await createSession(dir as string);
        },
      },
      {
        id: "close-session",
        key: "w",
        modifiers: ["meta"],
        description: "Close session",
        action: () => {
          if (!activeSessionId) return;
          const session = sessions[activeSessionId];
          if (!session) return;
          if (session.status === "running") {
            stopSession(activeSessionId);
          } else {
            removeSession(activeSessionId);
          }
        },
      },
    ];

    // Cmd+1 through Cmd+9
    for (let i = 1; i <= 9; i++) {
      list.push({
        id: `switch-session-${i}`,
        key: String(i),
        modifiers: ["meta"],
        description: `Switch to session ${i}`,
        action: () => {
          const targetId = sortedSessionIds[i - 1];
          if (targetId) setActiveSession(targetId);
        },
      });
    }

    return list;
  }, [activeSessionId, sessions, sortedSessionIds, createSession, setActiveSession, stopSession, removeSession]);

  useShortcuts(shortcuts);

  return (
    <PanelGroup direction="horizontal" className="h-full">
      {/* Sidebar */}
      <Panel defaultSize={15} minSize={12} maxSize={30}>
        <Sidebar />
      </Panel>

      <PanelResizeHandle className={resizeHandleClass} />

      {/* Conversation Panel */}
      <Panel defaultSize={45} minSize={25}>
        {activeSessionId ? (
          <TerminalPanel key={activeSessionId} sessionId={activeSessionId} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg text-[var(--text-secondary)]">
                No active session
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Click "+ New" in the sidebar to start a Claude Code session
              </p>
            </div>
          </div>
        )}
      </Panel>

      {/* Code Viewer Panel */}
      {activeSession && (
        <>
          <PanelResizeHandle className={resizeHandleClass} />
          <Panel defaultSize={40} minSize={20}>
            <CodeViewer
              key={activeSessionId!}
              sessionId={activeSessionId!}
              workingDir={activeSession.workingDir}
            />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
