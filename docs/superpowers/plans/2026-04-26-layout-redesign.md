# Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 72px icon rail with a full-width resizable sidebar, add live git status + Commit button to the header, and expand the right panel to four tabs (Summary, Review, Code, Usage).

**Architecture:** Approach B — new focused components with clean file boundaries. `SessionRail.tsx` is deleted and replaced by `Sidebar.tsx` + five sub-components. A new `git.rs` Tauri module provides two commands (`git_status`, `git_commit`) polled by a `useGitStatus` hook. The right panel inline code in `Layout.tsx` is extracted into `RightPanel.tsx` with a new `SummaryTab.tsx`.

**Tech Stack:** React 18, TypeScript, Tauri v2 (Rust), Zustand, react-resizable-panels, Tailwind CSS, Lucide icons

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/git.rs` | **Create** | `git_status` + `git_commit` Tauri commands |
| `src-tauri/src/lib.rs` | **Modify** | Register git module + commands |
| `src/lib/types.ts` | **Modify** | Add `GitStatus` interface |
| `src/lib/tauri.ts` | **Modify** | Add `gitStatus()` and `gitCommit()` wrappers |
| `src/hooks/useGitStatus.ts` | **Create** | Polls git status every 5s |
| `src/components/CommitModal.tsx` | **Create** | Commit message input + submit |
| `src/components/AppHeader.tsx` | **Modify** | Add git branch, diff stats, Commit button |
| `src/stores/workspaceStore.ts` | **Modify** | Add `sessionCountByWorkspace` selector |
| `src/components/SessionRow.tsx` | **Create** | Single session row (name, workspace, time, dot) |
| `src/components/SessionGroup.tsx` | **Create** | ACTIVE / RECENT labelled section |
| `src/components/WorkspaceList.tsx` | **Create** | Workspace list with session counts |
| `src/components/SidebarSearch.tsx` | **Create** | Controlled search input |
| `src/components/SidebarNav.tsx` | **Create** | All chats / Automations / Plugins nav |
| `src/components/Sidebar.tsx` | **Create** | Sidebar orchestrator |
| `src/components/SummaryTab.tsx` | **Create** | Parses session output for plan + tool calls |
| `src/components/RightPanel.tsx` | **Create** | Four-tab right panel container |
| `src/components/Layout.tsx` | **Modify** | Wire Sidebar + RightPanel, add useGitStatus |
| `src/components/SessionRail.tsx` | **Delete** | Replaced by Sidebar |

---

## Task 1: Rust git module

**Files:**
- Create: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/git.rs`**

```rust
use serde::Serialize;
use std::process::Command;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub added: u32,
    pub removed: u32,
    pub has_changes: bool,
}

#[tauri::command]
pub async fn git_status(working_dir: String) -> Result<GitStatus, String> {
    let branch = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !branch.status.success() {
        return Err("not a git repository".into());
    }

    let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();

    let diff = Command::new("git")
        .args(["diff", "--stat", "HEAD"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| e.to_string())?;

    let diff_output = String::from_utf8_lossy(&diff.stdout).to_string();

    // Also check for untracked/staged changes not in HEAD diff
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| e.to_string())?;

    let has_changes = !String::from_utf8_lossy(&status.stdout).trim().is_empty();

    // Parse "+ N, - M" from last line of diff --stat
    let (added, removed) = parse_diff_stat(&diff_output);

    Ok(GitStatus {
        branch,
        added,
        removed,
        has_changes,
    })
}

fn parse_diff_stat(output: &str) -> (u32, u32) {
    // Last line looks like: " 3 files changed, 42 insertions(+), 18 deletions(-)"
    let last = output.lines().last().unwrap_or("");
    let added = extract_number(last, "insertion");
    let removed = extract_number(last, "deletion");
    (added, removed)
}

fn extract_number(line: &str, keyword: &str) -> u32 {
    line.split_whitespace()
        .zip(line.split_whitespace().skip(1))
        .find(|(_, b)| b.starts_with(keyword))
        .and_then(|(a, _)| a.parse().ok())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn git_commit(working_dir: String, message: String) -> Result<(), String> {
    // Stage all changes (tracked + untracked)
    let add = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).to_string());
    }

    let commit = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !commit.status.success() {
        return Err(String::from_utf8_lossy(&commit.stderr).to_string());
    }

    Ok(())
}
```

- [ ] **Step 2: Register the git module in `src-tauri/src/lib.rs`**

Add `mod git;` at the top with the other mods, and add the two commands to `invoke_handler`:

```rust
mod db;
mod fs;
mod git;   // ← add this
mod pty;
mod tokens;
```

In `invoke_handler`, add:
```rust
git::git_status,
git::git_commit,
```

- [ ] **Step 3: Build to confirm it compiles**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: no errors. Fix any type/import issues before continuing.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/lib.rs
git commit -m "feat: add git_status and git_commit Tauri commands"
```

---

## Task 2: TypeScript types + tauri.ts wrappers

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add `GitStatus` to `src/lib/types.ts`**

Add after the `SessionTemplate` interface:

```typescript
export interface GitStatus {
  branch: string;
  added: number;
  removed: number;
  hasChanges: boolean;
}
```

- [ ] **Step 2: Add wrappers to `src/lib/tauri.ts`**

Add at the bottom of the file, after the existing exports:

```typescript
import type { GitStatus } from "./types";

export function gitStatus(workingDir: string): Promise<GitStatus> {
  return invoke("git_status", { workingDir });
}

export function gitCommit(workingDir: string, message: string): Promise<void> {
  return invoke("git_commit", { workingDir, message });
}
```

Note: `invoke` is already imported at the top of `tauri.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts
git commit -m "feat: add GitStatus type and tauri wrappers for git commands"
```

---

## Task 3: useGitStatus hook

**Files:**
- Create: `src/hooks/useGitStatus.ts`

- [ ] **Step 1: Create `src/hooks/useGitStatus.ts`**

```typescript
import { useEffect, useState } from "react";
import { gitStatus } from "../lib/tauri";
import type { GitStatus } from "../lib/types";

export function useGitStatus(workingDir: string | undefined): GitStatus | null {
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    if (!workingDir) {
      setStatus(null);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const result = await gitStatus(workingDir!);
        if (!cancelled) setStatus(result);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }

    poll();
    const interval = setInterval(poll, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workingDir]);

  return status;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useGitStatus.ts
git commit -m "feat: add useGitStatus polling hook"
```

---

## Task 4: CommitModal

**Files:**
- Create: `src/components/CommitModal.tsx`

- [ ] **Step 1: Create `src/components/CommitModal.tsx`**

```tsx
import { useState } from "react";
import { gitCommit } from "../lib/tauri";

interface CommitModalProps {
  workingDir: string;
  onClose: () => void;
}

export function CommitModal({ workingDir, onClose }: CommitModalProps) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await gitCommit(workingDir, message.trim());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[420px] rounded-xl shadow-xl flex flex-col"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="text-sm font-semibold text-[var(--ink-0)]">Commit changes</span>
          <button
            onClick={onClose}
            className="text-[var(--ink-2)] hover:text-[var(--ink-0)] transition-colors"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message…"
            rows={3}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm text-[var(--ink-0)] bg-[var(--surface-2)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
          />
          {error && (
            <p className="text-xs text-[var(--negative)]">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg text-[var(--ink-1)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!message.trim() || loading}
              className="px-3 py-1.5 text-xs rounded-lg text-white font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--positive)" }}
            >
              {loading ? "Committing…" : "Commit all"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/CommitModal.tsx
git commit -m "feat: add CommitModal component"
```

---

## Task 5: AppHeader — git integration

**Files:**
- Modify: `src/components/AppHeader.tsx`

- [ ] **Step 1: Update `src/components/AppHeader.tsx`**

Replace the entire file with:

```tsx
import { useState } from "react";
import { PanelLeft, TerminalSquare, PanelRight, Loader2, GitBranch } from "lucide-react";
import type { SessionStatus } from "../lib/types";
import type { GitStatus } from "../lib/types";
import { CommitModal } from "./CommitModal";

interface AppHeaderProps {
  sessionName?: string;
  sessionStatus?: SessionStatus;
  workspaceName?: string;
  workingDir?: string;
  gitStatus?: GitStatus | null;
  hasActiveSession: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  terminalVisible: boolean;
  onToggleTerminal: () => void;
  rightPanelVisible: boolean;
  onToggleRightPanel: () => void;
}

function iconBtn(active: boolean) {
  return active
    ? "flex items-center justify-center w-7 h-7 rounded text-[var(--accent)] bg-[var(--accent-dim)] hover:bg-[var(--accent-dim)] transition-colors"
    : "flex items-center justify-center w-7 h-7 rounded text-[var(--ink-1)] hover:text-[var(--ink-0)] hover:bg-[var(--surface-2)] transition-colors";
}

export function AppHeader({
  sessionName,
  sessionStatus,
  workspaceName,
  workingDir,
  gitStatus,
  hasActiveSession,
  sidebarCollapsed,
  onToggleSidebar,
  terminalVisible,
  onToggleTerminal,
  rightPanelVisible,
  onToggleRightPanel,
}: AppHeaderProps) {
  const [showCommit, setShowCommit] = useState(false);

  return (
    <>
      <header className="h-11 flex items-center flex-shrink-0 bg-[var(--surface-1)] border-b border-[var(--border)] px-2 gap-0.5 select-none">
        {/* Sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className={iconBtn(sidebarCollapsed)}
          title="Toggle sidebar (⌘B)"
        >
          <PanelLeft size={15} />
        </button>

        <div className="w-px h-5 bg-[var(--border)] mx-2 flex-shrink-0" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 text-[12.5px] text-[var(--ink-1)] overflow-hidden">
          {workspaceName && (
            <>
              <span className="truncate max-w-[120px]">{workspaceName}</span>
              <span className="flex-shrink-0 text-[var(--ink-2)]">›</span>
            </>
          )}
          {sessionName ? (
            <>
              {sessionStatus === 'running' ? (
                <Loader2 size={11} className="text-[var(--positive)] animate-spin flex-shrink-0" />
              ) : sessionStatus === 'starting' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse flex-shrink-0" />
              ) : sessionStatus === 'errored' || sessionStatus === 'crashed' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--negative)] flex-shrink-0" />
              ) : sessionStatus === 'stopped' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-2)] flex-shrink-0" />
              ) : null}
              <span className="font-medium text-[var(--ink-0)] truncate">{sessionName}</span>
            </>
          ) : (
            <span className="text-[var(--ink-2)]">Claude Window</span>
          )}

          {/* Git branch + diff stats */}
          {gitStatus && (
            <>
              <div className="w-px h-4 bg-[var(--border)] mx-1 flex-shrink-0" />
              <GitBranch size={11} className="text-[var(--ink-2)] flex-shrink-0" />
              <span className="text-[var(--ink-1)] truncate max-w-[140px]">{gitStatus.branch}</span>
              {(gitStatus.added > 0 || gitStatus.removed > 0) && (
                <>
                  <span className="text-[var(--positive)] font-semibold text-[11px] flex-shrink-0">+{gitStatus.added}</span>
                  <span className="text-[var(--negative)] font-semibold text-[11px] flex-shrink-0">−{gitStatus.removed}</span>
                </>
              )}
            </>
          )}
        </div>

        {/* Right controls */}
        {hasActiveSession && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={onToggleTerminal}
              className={iconBtn(terminalVisible)}
              title="Toggle terminal (⌘J)"
            >
              <TerminalSquare size={15} />
            </button>
            <button
              onClick={onToggleRightPanel}
              className={iconBtn(rightPanelVisible)}
              title="Toggle code pane (⌘⌥B)"
            >
              <PanelRight size={15} />
            </button>

            {/* Commit button — only when changes exist */}
            {gitStatus?.hasChanges && workingDir && (
              <>
                <div className="w-px h-5 bg-[var(--border)] mx-1 flex-shrink-0" />
                <button
                  onClick={() => setShowCommit(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-white text-xs font-semibold transition-colors"
                  style={{ background: "var(--positive)" }}
                  title="Commit all changes"
                >
                  ✓ Commit
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {showCommit && workingDir && (
        <CommitModal workingDir={workingDir} onClose={() => setShowCommit(false)} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "feat: add git branch, diff stats, and Commit button to AppHeader"
```

---

## Task 6: workspaceStore — session count selector

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add `sessionCountByWorkspace` to `src/stores/workspaceStore.ts`**

Add at the bottom of the file, after `getNotificationsEnabled`:

```typescript
import type { SessionInfo } from "../lib/types";

export function sessionCountByWorkspace(
  sessions: Record<string, SessionInfo>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const session of Object.values(sessions)) {
    if (session.workspaceId) {
      counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1;
    }
  }
  return counts;
}
```

Note: `SessionInfo` is already exported from `../lib/types` — check the import at the top of the file; if it's not imported, add it.

- [ ] **Step 2: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add sessionCountByWorkspace selector to workspaceStore"
```

---

## Task 7: SessionRow component

**Files:**
- Create: `src/components/SessionRow.tsx`

- [ ] **Step 1: Create `src/components/SessionRow.tsx`**

```tsx
import type { SessionInfo } from "../lib/types";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface SessionRowProps {
  session: SessionInfo;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const statusColor: Record<string, string> = {
  running: "var(--accent)",
  starting: "var(--warning)",
  stopped: "var(--ink-2)",
  errored: "var(--negative)",
  crashed: "var(--negative)",
};

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function SessionRow({ session, isActive, onClick, onContextMenu }: SessionRowProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceName = session.workspaceId ? workspaces[session.workspaceId]?.name : undefined;
  const dot = statusColor[session.status] ?? "var(--ink-2)";
  const isPulsing = session.status === "running" || session.status === "starting";

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={session.name}
      className="w-full text-left px-3 py-2 rounded-lg transition-colors flex flex-col gap-0.5"
      style={{
        background: isActive ? "var(--accent-dim)" : "transparent",
        cursor: "pointer",
        border: "none",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <div className="flex items-center gap-1.5 w-full min-w-0">
        <span
          className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${isPulsing ? "animate-pulse" : ""}`}
          style={{ background: dot }}
        />
        <span
          className="flex-1 min-w-0 truncate text-[12.5px] font-medium"
          style={{ color: isActive ? "var(--ink-0)" : "var(--ink-1)" }}
        >
          {session.name}
        </span>
        <span className="flex-shrink-0 text-[10px] text-[var(--ink-2)]">
          {timeAgo(session.updatedAt || session.createdAt)}
        </span>
      </div>
      {workspaceName && (
        <span className="ml-3 text-[10px] text-[var(--ink-2)] truncate">
          {workspaceName}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SessionRow.tsx
git commit -m "feat: add SessionRow component"
```

---

## Task 8: SessionGroup component

**Files:**
- Create: `src/components/SessionGroup.tsx`

- [ ] **Step 1: Create `src/components/SessionGroup.tsx`**

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SessionInfo } from "../lib/types";
import { SessionRow } from "./SessionRow";

interface SessionGroupProps {
  label: string;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

export function SessionGroup({
  label,
  sessions,
  activeSessionId,
  onSelect,
  onContextMenu,
}: SessionGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (sessions.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1 px-3 py-1 w-full text-left select-none"
        style={{ border: "none", background: "transparent", cursor: "pointer" }}
      >
        <span className="text-[10px] font-semibold tracking-widest text-[var(--ink-2)] uppercase flex-1">
          {label} {sessions.length}
        </span>
        {collapsed
          ? <ChevronRight size={11} className="text-[var(--ink-2)]" />
          : <ChevronDown size={11} className="text-[var(--ink-2)]" />
        }
      </button>

      {!collapsed && sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClick={() => onSelect(session.id)}
          onContextMenu={(e) => onContextMenu(e, session.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SessionGroup.tsx
git commit -m "feat: add SessionGroup component"
```

---

## Task 9: WorkspaceList component

**Files:**
- Create: `src/components/WorkspaceList.tsx`

- [ ] **Step 1: Create `src/components/WorkspaceList.tsx`**

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useWorkspaceStore, sessionCountByWorkspace } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";

interface WorkspaceListProps {
  activeWorkspaceFilter: string | null;
  onFilterChange: (id: string | null) => void;
  onCreateWorkspace: () => void;
}

export function WorkspaceList({
  activeWorkspaceFilter,
  onFilterChange,
  onCreateWorkspace,
}: WorkspaceListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sessions = useSessionStore((s) => s.sessions);
  const counts = sessionCountByWorkspace(sessions);
  const workspaceList = Object.values(workspaces).sort((a, b) => a.name.localeCompare(b.name));

  if (workspaceList.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1 px-3 py-1 w-full text-left select-none"
        style={{ border: "none", background: "transparent", cursor: "pointer" }}
      >
        <span className="text-[10px] font-semibold tracking-widest text-[var(--ink-2)] uppercase flex-1">
          Workspaces {workspaceList.length}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onCreateWorkspace(); }}
          className="text-[var(--ink-2)] hover:text-[var(--ink-0)] transition-colors"
          title="New workspace"
        >
          <Plus size={11} />
        </button>
        {collapsed
          ? <ChevronRight size={11} className="text-[var(--ink-2)]" />
          : <ChevronDown size={11} className="text-[var(--ink-2)]" />
        }
      </button>

      {!collapsed && workspaceList.map((ws) => {
        const isSelected = activeWorkspaceFilter === ws.id;
        return (
          <button
            key={ws.id}
            onClick={() => onFilterChange(isSelected ? null : ws.id)}
            className="flex items-center justify-between px-3 py-1.5 mx-1 rounded-lg text-[12.5px] transition-colors"
            style={{
              border: "none",
              background: isSelected ? "var(--accent-dim)" : "transparent",
              color: isSelected ? "var(--ink-0)" : "var(--ink-1)",
              cursor: "pointer",
              fontWeight: isSelected ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = "var(--surface-2)";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = "transparent";
            }}
          >
            <span className="truncate">{ws.name}</span>
            {counts[ws.id] != null && (
              <span className="text-[10px] text-[var(--ink-2)] flex-shrink-0 ml-2">
                {counts[ws.id]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/WorkspaceList.tsx
git commit -m "feat: add WorkspaceList component"
```

---

## Task 10: SidebarSearch component

**Files:**
- Create: `src/components/SidebarSearch.tsx`

- [ ] **Step 1: Create `src/components/SidebarSearch.tsx`**

```tsx
import { Search, X } from "lucide-react";

interface SidebarSearchProps {
  value: string;
  onChange: (v: string) => void;
}

export function SidebarSearch({ value, onChange }: SidebarSearchProps) {
  return (
    <div className="relative mx-2">
      <Search
        size={12}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-2)] pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        className="w-full pl-7 pr-6 py-1.5 text-[12.5px] rounded-lg bg-[var(--surface-2)] text-[var(--ink-0)] placeholder:text-[var(--ink-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        style={{ border: "1px solid var(--border)" }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-2)] hover:text-[var(--ink-0)]"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SidebarSearch.tsx
git commit -m "feat: add SidebarSearch component"
```

---

## Task 11: SidebarNav component

**Files:**
- Create: `src/components/SidebarNav.tsx`

- [ ] **Step 1: Create `src/components/SidebarNav.tsx`**

```tsx
import { MessageSquare, Zap, Puzzle } from "lucide-react";

type NavView = "all";

interface SidebarNavProps {
  activeView: NavView;
  onViewChange: (v: NavView) => void;
}

function NavItem({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 px-3 py-1.5 w-full rounded-lg text-[12.5px] transition-colors text-left"
      style={{
        border: "none",
        background: active ? "var(--accent-dim)" : "transparent",
        color: disabled ? "var(--ink-2)" : active ? "var(--ink-0)" : "var(--ink-1)",
        fontWeight: active ? 600 : 400,
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {disabled && (
        <span
          className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "var(--surface-2)", color: "var(--ink-2)", letterSpacing: "0.04em" }}
        >
          SOON
        </span>
      )}
    </button>
  );
}

export function SidebarNav({ activeView, onViewChange }: SidebarNavProps) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <NavItem
        icon={<MessageSquare size={14} />}
        label="All chats"
        active={activeView === "all"}
        onClick={() => onViewChange("all")}
      />
      <NavItem
        icon={<Zap size={14} />}
        label="Automations"
        disabled
      />
      <NavItem
        icon={<Puzzle size={14} />}
        label="Plugins"
        disabled
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SidebarNav.tsx
git commit -m "feat: add SidebarNav component"
```

---

## Task 12: Sidebar orchestrator

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Create `src/components/Sidebar.tsx`**

```tsx
import { useState, useRef, useEffect } from "react";
import { Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { open } from "@tauri-apps/plugin-dialog";
import type { SessionInfo, SessionStatus } from "../lib/types";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarNav } from "./SidebarNav";
import { WorkspaceList } from "./WorkspaceList";
import { SessionGroup } from "./SessionGroup";

const RECENT_CAP = 20;

const ACTIVE_STATUSES: SessionStatus[] = ["running", "starting"];
const RECENT_STATUSES: SessionStatus[] = ["stopped", "errored", "crashed"];

interface ContextMenuState {
  sessionId: string;
  x: number;
  y: number;
}

interface SidebarProps {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const stopSession = useSessionStore((s) => s.stopSession);
  const restartSession = useSessionStore((s) => s.restartSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);

  const [search, setSearch] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [contextMenu]);

  const allSessions = Object.values(sessions).sort((a, b) => b.createdAt - a.createdAt);

  function filterSession(s: SessionInfo): boolean {
    if (search) {
      return s.name.toLowerCase().includes(search.toLowerCase());
    }
    if (workspaceFilter) {
      return s.workspaceId === workspaceFilter;
    }
    return true;
  }

  const activeSessions = allSessions
    .filter((s) => ACTIVE_STATUSES.includes(s.status) && filterSession(s));

  const recentSessions = allSessions
    .filter((s) => RECENT_STATUSES.includes(s.status) && filterSession(s))
    .slice(0, RECENT_CAP);

  async function handleNewSession() {
    const dir = await open({ directory: true, multiple: false });
    if (dir) await createSession(dir as string);
  }

  async function handleCreateWorkspace() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir) return;
    const name = (dir as string).split("/").pop() ?? "Workspace";
    await createWorkspace(name, dir as string);
  }

  function handleContextMenu(e: React.MouseEvent, sessionId: string) {
    e.preventDefault();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  }

  const contextSession = contextMenu ? sessions[contextMenu.sessionId] : null;

  return (
    <div
      className="h-full w-full flex flex-col select-none overflow-hidden"
      style={{ background: "var(--surface-1)", borderRight: "1px solid var(--border)" }}
    >
      {/* New session button */}
      <div className="flex-shrink-0 px-2 pt-3 pb-2">
        <button
          onClick={handleNewSession}
          className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-white text-[12.5px] font-semibold transition-colors"
          style={{ background: "var(--accent)", border: "none", cursor: "pointer" }}
          title="New session (⌘N)"
        >
          <span className="flex items-center gap-2">
            <Plus size={14} strokeWidth={2.4} />
            New chat
          </span>
          <span className="opacity-60 text-[11px]">⌘N</span>
        </button>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 pb-2">
        <SidebarSearch value={search} onChange={setSearch} />
      </div>

      {/* Nav items */}
      <div className="flex-shrink-0 pb-2">
        <SidebarNav activeView="all" onViewChange={() => {}} />
      </div>

      <div className="flex-shrink-0 h-px bg-[var(--border)] mx-2 mb-2" />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pb-2">
        {/* Workspaces */}
        <WorkspaceList
          activeWorkspaceFilter={workspaceFilter}
          onFilterChange={setWorkspaceFilter}
          onCreateWorkspace={handleCreateWorkspace}
        />

        {/* Active sessions */}
        <SessionGroup
          label="Active"
          sessions={activeSessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSession}
          onContextMenu={handleContextMenu}
        />

        {/* Recent sessions */}
        <SessionGroup
          label="Recent"
          sessions={recentSessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSession}
          onContextMenu={handleContextMenu}
        />

        {/* Empty state */}
        {activeSessions.length === 0 && recentSessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <p className="text-xs text-[var(--ink-2)]">
              {search ? "No sessions match your search" : "No sessions yet"}
            </p>
          </div>
        )}
      </div>

      {/* Bottom: settings + avatar */}
      <div className="flex-shrink-0 border-t border-[var(--border)] px-2 py-2 flex items-center gap-2">
        <div
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: "var(--ink-0)", color: "var(--surface-1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}
        >
          A
        </div>
        <span className="flex-1 text-xs text-[var(--ink-1)]">Account</span>
        <button
          onClick={onOpenSettings}
          className="text-[var(--ink-2)] hover:text-[var(--ink-0)] transition-colors p-1 rounded"
          title="Settings"
        >
          ⚙
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && contextSession && (
        <div
          ref={contextMenuRef}
          style={{
            position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 100,
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            overflow: "hidden", minWidth: 160, padding: "2px 0",
          }}
        >
          <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--ink-2)", fontWeight: 500, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-mono)" }}>
            {contextSession.name}
          </div>
          {contextSession.status === "running" && (
            <button onClick={() => { stopSession(contextSession.id); setContextMenu(null); }} style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--ink-0)", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <Square size={12} style={{ color: "var(--negative)" }} /> Stop
            </button>
          )}
          {(contextSession.status === "stopped" || contextSession.status === "errored" || contextSession.status === "crashed") && (
            <button onClick={() => { restartSession(contextSession.id); setContextMenu(null); }} style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--ink-0)", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <RotateCcw size={12} style={{ color: "var(--accent)" }} /> Restart
            </button>
          )}
          <button onClick={() => { removeSession(contextSession.id); setContextMenu(null); }} style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, color: "var(--negative)", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <Trash2 size={12} /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add full Sidebar orchestrator component"
```

---

## Task 13: SummaryTab component

**Files:**
- Create: `src/components/SummaryTab.tsx`

- [ ] **Step 1: Create `src/components/SummaryTab.tsx`**

```tsx
import { useMemo } from "react";
import { getOutputBuffer } from "../stores/sessionStore";
import type { GitStatus, SessionInfo } from "../lib/types";

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b[^a-zA-Z]*[a-zA-Z]/g, "");
}

interface PlanStep {
  text: string;
  done: boolean;
  active: boolean;
}

interface ParsedSummary {
  planSteps: PlanStep[];
  planTotal: number;
  planDone: number;
  recentToolCalls: string[];
}

const TOOL_PREFIXES = ["Read", "Write", "Edit", "Grep", "Bash", "Glob", "LS", "TodoWrite", "TodoRead"];

function parseOutput(chunks: string[]): ParsedSummary {
  const raw = chunks.join("");
  const text = stripAnsi(raw);
  const lines = text.split(/\r?\n/);

  // Find the last PLAN block header: "PLAN · N/M STEPS DONE"
  let planDone = 0;
  let planTotal = 0;
  let planLineIndex = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/PLAN\s*[·•]\s*(\d+)\/(\d+)\s*STEPS?\s*DONE/i);
    if (m) {
      planDone = parseInt(m[1], 10);
      planTotal = parseInt(m[2], 10);
      planLineIndex = i;
      break;
    }
  }

  // Extract step lines after the plan header
  const planSteps: PlanStep[] = [];
  if (planLineIndex >= 0) {
    for (let i = planLineIndex + 1; i < lines.length && planSteps.length < planTotal; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Done: starts with ✓ ✔ ☑ [x] [X]
      if (/^[✓✔☑]|^\[x\]|^\[X\]/u.test(line)) {
        planSteps.push({ text: line.replace(/^[✓✔☑\[\]xX\s]+/, "").trim(), done: true, active: false });
      }
      // Active: starts with ⟳ ⊙ → spinning markers
      else if (/^[⟳⊙→⠿]/u.test(line)) {
        planSteps.push({ text: line.replace(/^[⟳⊙→⠿\s]+/, "").trim(), done: false, active: true });
      }
      // Pending: starts with ○ □ [ ]
      else if (/^[○□]|^\[ \]/u.test(line)) {
        planSteps.push({ text: line.replace(/^[○□\[\]\s]+/, "").trim(), done: false, active: false });
      }
    }
  }

  // Collect the last 10 tool call lines
  const recentToolCalls = lines
    .filter((line) => TOOL_PREFIXES.some((p) => line.trimStart().startsWith(p + " ") || line.trimStart().startsWith(p + "\t")))
    .slice(-10)
    .reverse();

  return { planSteps, planTotal, planDone, recentToolCalls };
}

interface SummaryTabProps {
  session: SessionInfo;
  gitStatus: GitStatus | null;
}

export function SummaryTab({ session, gitStatus }: SummaryTabProps) {
  const chunks = getOutputBuffer(session.id);

  const summary = useMemo(() => parseOutput(chunks), [chunks.length]);

  const dirName = session.workingDir.split("/").pop() ?? session.workingDir;

  return (
    <div className="h-full overflow-y-auto p-3 flex flex-col gap-4 text-[12.5px]">
      {/* Session metadata */}
      <div>
        <div className="text-[10px] font-semibold tracking-widest text-[var(--ink-2)] uppercase mb-1.5">Session</div>
        <div className="font-semibold text-[var(--ink-0)]">{session.name}</div>
        <div className="text-[var(--ink-2)] mt-0.5">{dirName}{gitStatus ? ` · ${gitStatus.branch}` : ""} · {session.status}</div>
      </div>

      {/* Plan progress */}
      {summary.planTotal > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-[var(--ink-2)] uppercase mb-1.5">
            Plan · {summary.planDone}/{summary.planTotal} steps
          </div>
          <div className="flex flex-col gap-1">
            {summary.planSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span
                  className="flex-shrink-0 mt-0.5"
                  style={{
                    color: step.done ? "var(--positive)" : step.active ? "var(--accent)" : "var(--ink-2)",
                  }}
                >
                  {step.done ? "✓" : step.active ? "⟳" : "○"}
                </span>
                <span
                  style={{
                    color: step.done ? "var(--ink-2)" : step.active ? "var(--ink-0)" : "var(--ink-2)",
                    textDecoration: step.done ? "line-through" : "none",
                  }}
                >
                  {step.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent tool calls */}
      {summary.recentToolCalls.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-[var(--ink-2)] uppercase mb-1.5">Recent tool calls</div>
          <div className="flex flex-col gap-0.5">
            {summary.recentToolCalls.map((line, i) => (
              <div key={i} className="text-[var(--ink-1)] truncate font-mono text-[11px]">{line.trim()}</div>
            ))}
          </div>
        </div>
      )}

      {/* No content yet */}
      {summary.planTotal === 0 && summary.recentToolCalls.length === 0 && (
        <div className="text-[var(--ink-2)] text-center py-4">Session activity will appear here</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SummaryTab.tsx
git commit -m "feat: add SummaryTab with plan progress and tool call parsing"
```

---

## Task 14: RightPanel component

**Files:**
- Create: `src/components/RightPanel.tsx`
- Modify: `src/components/FileChangesPanel.tsx` — no code changes needed, just verify it accepts `sessionId` and `workingDir` props (it already does)

- [ ] **Step 1: Create `src/components/RightPanel.tsx`**

Note: `FileChangesPanel` takes `{ sessionId, onSelectFile }` (no `workingDir`). `CodeViewer` already embeds `FileChangesPanel` internally, so the Review tab uses a standalone `FileChangesPanel` for quick accept/reject, while Code tab uses `CodeViewer` for the full file tree + diff editor experience.

```tsx
import { useState } from "react";
import { CodeViewer } from "./CodeViewer";
import { TokenDashboard } from "./TokenDashboard";
import { FileChangesPanel } from "./FileChangesPanel";
import { SummaryTab } from "./SummaryTab";
import type { GitStatus, SessionInfo } from "../lib/types";

type Tab = "summary" | "review" | "code" | "usage";

interface RightPanelProps {
  session: SessionInfo;
  gitStatus: GitStatus | null;
}

export function RightPanel({ session, gitStatus }: RightPanelProps) {
  const [tab, setTab] = useState<Tab>("summary");

  function tabCls(t: Tab) {
    return tab === t
      ? "px-3 py-2 text-xs font-medium text-[var(--accent)] border-b border-[var(--accent)] transition-colors"
      : "px-3 py-2 text-xs font-medium text-[var(--ink-1)] hover:text-[var(--ink-0)] transition-colors";
  }

  return (
    <div className="h-full flex flex-col bg-[var(--surface-1)]">
      <div className="flex border-b border-[var(--border)] flex-shrink-0">
        <button className={tabCls("summary")} onClick={() => setTab("summary")}>Summary</button>
        <button className={tabCls("review")} onClick={() => setTab("review")}>Review</button>
        <button className={tabCls("code")} onClick={() => setTab("code")}>Code</button>
        <button className={tabCls("usage")} onClick={() => setTab("usage")}>Usage</button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "summary" && (
          <SummaryTab session={session} gitStatus={gitStatus} />
        )}
        {tab === "review" && (
          <FileChangesPanel
            sessionId={session.id}
            onSelectFile={() => setTab("code")}
          />
        )}
        {tab === "code" && (
          <CodeViewer sessionId={session.id} workingDir={session.workingDir} />
        )}
        {tab === "usage" && (
          <TokenDashboard workingDir={session.workingDir} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify FileChangesPanel and CodeViewer props**

```bash
grep -n "interface.*Props\|export function" src/components/FileChangesPanel.tsx src/components/CodeViewer.tsx | head -10
```

Confirm:
- `FileChangesPanel` accepts `{ sessionId: string; onSelectFile: (path, original, modified) => void }`
- `CodeViewer` accepts `{ sessionId: string; workingDir: string }`

If names differ from above, update the JSX in `RightPanel.tsx` to match before committing.

- [ ] **Step 3: Commit**

```bash
git add src/components/RightPanel.tsx
git commit -m "feat: add RightPanel with Summary, Review, Code, Usage tabs"
```

---

## Task 15: Layout.tsx — wire everything together

**Files:**
- Modify: `src/components/Layout.tsx`
- Delete: `src/components/SessionRail.tsx`

- [ ] **Step 1: Replace `src/components/Layout.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "./RightPanel";
import { TerminalPanel } from "./TerminalPanel";
import { IntegratedTerminal } from "./IntegratedTerminal";
import { AppHeader } from "./AppHeader";
import { useSessionStore, getRateLimitedSessionIds, clearRateLimit } from "../stores/sessionStore";
import { useShortcuts } from "../hooks/useShortcuts";
import { useGitStatus } from "../hooks/useGitStatus";
import type { Shortcut } from "../hooks/useShortcuts";
import { open } from "@tauri-apps/plugin-dialog";
import { checkClaudeVersion, dbLoadSetting } from "../lib/tauri";
import { initNotifications } from "../lib/notifications";
import { OnboardingModal } from "./OnboardingModal";
import { SettingsModal } from "./SettingsModal";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { UpdateBanner } from "./UpdateBanner";
import { useUpdaterStore } from "../stores/updaterStore";
import { StatusBar } from "./StatusBar";

const colHandle = "w-[2px] bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-col-resize";
const rowHandle = "h-[2px] bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-row-resize";

export function Layout() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = useSessionStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const stopSession = useSessionStore((s) => s.stopSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const loadSessionOutput = useSessionStore((s) => s.loadSessionOutput);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [versionWarning, setVersionWarning] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const gitStatus = useGitStatus(activeSession?.workingDir);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
    const savedSize = localStorage.getItem("fontSize");
    if (savedSize) {
      const sizes: Record<string, string> = { small: "12px", medium: "13px", large: "14px" };
      if (sizes[savedSize]) document.documentElement.style.fontSize = sizes[savedSize];
    }
    loadSessions();
    initNotifications();
    loadWorkspaces();
    dbLoadSetting("onboarding_complete").then((val) => {
      if (!val) setShowOnboarding(true);
    });
  }, [loadSessions]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (activeSessionId) {
        setRateLimited(getRateLimitedSessionIds().has(activeSessionId));
      } else {
        setRateLimited(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  useEffect(() => {
    checkClaudeVersion()
      .then((version) => {
        const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
        if (!match) setVersionWarning(`Unexpected Claude CLI version format: ${version}`);
      })
      .catch(() => {
        setVersionWarning("Claude CLI not found. Install it to use Claude Window.");
      });
  }, []);

  useEffect(() => {
    useUpdaterStore.getState().checkForUpdate();
  }, []);

  useEffect(() => {
    if (activeSessionId) loadSessionOutput(activeSessionId);
  }, [activeSessionId, loadSessionOutput]);

  function toggleSidebar() {
    setSidebarCollapsed((v) => !v);
  }

  const sortedSessionIds = useMemo(() => {
    return Object.values(sessions)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => s.id);
  }, [sessions]);

  const workspaceName = useMemo(() => {
    if (!activeSession?.workspaceId) return undefined;
    return workspaces[activeSession.workspaceId]?.name;
  }, [activeSession, workspaces]);

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
      {
        id: "toggle-sidebar",
        key: "b",
        modifiers: ["meta"],
        description: "Toggle sidebar",
        action: toggleSidebar,
      },
      {
        id: "toggle-terminal",
        key: "j",
        modifiers: ["meta"],
        description: "Toggle terminal",
        action: () => setTerminalVisible((v) => !v),
      },
    ];

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
    <div className="h-full flex flex-col bg-[var(--surface-0)]">
      <AppHeader
        sessionName={activeSession?.name}
        sessionStatus={activeSession?.status}
        workspaceName={workspaceName}
        workingDir={activeSession?.workingDir}
        gitStatus={gitStatus}
        hasActiveSession={!!activeSession}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        terminalVisible={terminalVisible}
        onToggleTerminal={() => setTerminalVisible((v) => !v)}
        rightPanelVisible={rightPanelVisible}
        onToggleRightPanel={() => setRightPanelVisible((v) => !v)}
      />

      <UpdateBanner />

      {versionWarning && (
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--warning)] text-black text-xs flex-shrink-0">
          <span>{versionWarning}</span>
          <button onClick={() => setVersionWarning(null)} className="ml-4 hover:opacity-70 font-bold">×</button>
        </div>
      )}
      {rateLimited && activeSessionId && (
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--warning)] text-[var(--ink-0)] text-xs flex-shrink-0">
          <span>Rate limit detected — Claude Code is being throttled. Output may be delayed.</span>
          <button
            onClick={() => { clearRateLimit(activeSessionId); setRateLimited(false); }}
            className="ml-4 hover:opacity-70 font-bold"
          >×</button>
        </div>
      )}

      <PanelGroup direction="horizontal" className="flex-1 min-h-0 overflow-hidden" autoSaveId="layout-horizontal">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <Panel defaultSize={18} minSize={12} maxSize={28} id="sidebar" order={1}>
              <Sidebar onOpenSettings={() => setShowSettings(true)} />
            </Panel>
            <PanelResizeHandle className={colHandle} />
          </>
        )}

        {/* Main content column */}
        <Panel id="main" order={2}>
          <PanelGroup direction="vertical">
            {/* Conversation + right panel row */}
            <Panel defaultSize={terminalVisible ? 70 : 100} minSize={30} id="center-row" order={1}>
              <PanelGroup direction="horizontal">
                <Panel defaultSize={rightPanelVisible && activeSession ? 55 : 100} minSize={30} id="conversation" order={1}>
                  {activeSessionId ? (
                    <TerminalPanel key={activeSessionId} sessionId={activeSessionId} />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center">
                        <span className="text-2xl text-[var(--ink-2)]">⌘</span>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-[var(--ink-0)]">No session open</p>
                        <p className="text-xs text-[var(--ink-1)] mt-1">Press ⌘N or click + New to start a Claude Code session</p>
                      </div>
                    </div>
                  )}
                </Panel>

                {activeSession && rightPanelVisible && (
                  <>
                    <PanelResizeHandle className={colHandle} />
                    <Panel defaultSize={45} minSize={20} id="right-panel" order={2}>
                      <RightPanel session={activeSession} gitStatus={gitStatus} />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </Panel>

            {/* Bottom terminal */}
            {terminalVisible && activeSession && (
              <>
                <PanelResizeHandle className={rowHandle} />
                <Panel defaultSize={30} minSize={15} maxSize={60} id="terminal-row" order={2}>
                  <div className="h-full flex flex-col bg-[var(--surface-1)]">
                    <div className="flex items-center px-3 h-8 border-b border-[var(--border)] flex-shrink-0">
                      <span className="text-xs font-medium text-[var(--ink-1)]">Terminal</span>
                      <div className="flex-1" />
                      <button
                        onClick={() => setTerminalVisible(false)}
                        className="text-xs text-[var(--ink-2)] hover:text-[var(--ink-1)] transition-colors"
                        title="Close terminal (⌘J)"
                      >×</button>
                    </div>
                    <div className="flex-1 min-h-0">
                      <IntegratedTerminal
                        key={activeSessionId}
                        sessionId={activeSessionId!}
                        workingDir={activeSession.workingDir}
                      />
                    </div>
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>
      </PanelGroup>

      <StatusBar />

      {showOnboarding && <OnboardingModal onComplete={() => setShowOnboarding(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Delete SessionRail**

```bash
rm src/components/SessionRail.tsx
```

- [ ] **Step 3: Build the frontend to catch type errors**

```bash
npm run build 2>&1 | tail -30
```

Expected: no TypeScript errors. Common issues to fix:
- If `FileChangesPanel` prop names don't match, update `RightPanel.tsx` to use the correct names (grep with `grep -n "interface\|Props" src/components/FileChangesPanel.tsx`)
- If any import is missing, add it

- [ ] **Step 4: Run the app and verify**

```bash
npm run tauri dev
```

Verify:
1. Sidebar is visible at ~240px, shows "New chat", search, nav items, session groups
2. Sidebar drag handle resizes it
3. ⌘B collapses/restores sidebar
4. Sessions appear in ACTIVE or RECENT sections correctly
5. Clicking a session makes it active
6. Header shows git branch + diff stats for git-tracked sessions
7. Commit button appears when changes exist; CommitModal opens
8. Right panel shows Summary, Review, Code, Usage tabs
9. Summary tab shows session name and parses plan/tool calls from output

- [ ] **Step 5: Final commit**

```bash
git add src/components/Layout.tsx
git rm src/components/SessionRail.tsx
git commit -m "feat: wire Sidebar + RightPanel into Layout, delete SessionRail"
```
