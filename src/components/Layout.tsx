import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { TerminalPanel } from "./TerminalPanel";
import { CodeViewer } from "./CodeViewer";
import { useSessionStore } from "../stores/sessionStore";

const resizeHandleClass =
  "w-[3px] bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-col-resize";

export function Layout() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = useSessionStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null,
  );

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
