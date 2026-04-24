import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { TerminalPanel } from "./TerminalPanel";
import { useSessionStore } from "../stores/sessionStore";

export function Layout() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  return (
    <PanelGroup direction="horizontal" className="h-full">
      {/* Sidebar */}
      <Panel defaultSize={20} minSize={15} maxSize={35}>
        <Sidebar />
      </Panel>

      <PanelResizeHandle className="w-[3px] bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-col-resize" />

      {/* Main Content */}
      <Panel minSize={40}>
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
    </PanelGroup>
  );
}
