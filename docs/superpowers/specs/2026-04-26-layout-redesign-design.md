# Layout Redesign — Design Spec

**Date:** 2026-04-26  
**Scope:** Sidebar, Header (git integration), Right Panel  
**Reference:** Cursor-style design mockup provided by user

---

## Overview

Bring the app's shell closer to the reference design: replace the 72px icon rail with a full-width text sidebar, add git context to the header, and expand the right panel from two tabs to four. Approach B: new components with clean file boundaries, no new Zustand stores.

---

## 1. Sidebar

### What changes

`SessionRail.tsx` is deleted. A new `Sidebar.tsx` replaces it, wrapped in a `react-resizable-panels` `Panel` so the user can drag the right edge to resize it.

**Width:** default 240px, min 160px, max 360px. Chosen width is persisted to `localStorage` under the key `sidebarWidth`.

**Layout.tsx change:** The fixed `w-[72px]` div becomes a `Panel` + `PanelResizeHandle`. The sidebar is still hidden when `sidebarCollapsed === true` (collapses to 0, no icon rail fallback).

### Component tree

```
Sidebar.tsx                   ← orchestrator; reads sessionStore + workspaceStore
  SidebarSearch.tsx           ← controlled input, filters session list by name (client-side)
  SidebarNav.tsx              ← "All chats", "Automations" (soon), "Plugins" (soon)
  WorkspaceList.tsx           ← collapsible section; lists workspaces with session counts
  SessionGroup.tsx            ← renders one labelled section (ACTIVE or RECENT)
    SessionRow.tsx            ← single session entry: name, workspace label, timestamp, status dot
```

### Section definitions

| Section | Condition | Cap |
|---|---|---|
| ACTIVE | `status === 'running' \| 'starting'` | all |
| RECENT | `status === 'stopped' \| 'errored' \| 'crashed'` | 20 most recent |

### Filtering

- Clicking a workspace in `WorkspaceList` sets a local `activeWorkspaceFilter` in `Sidebar.tsx` state.  
- "All chats" clears the filter.  
- Both ACTIVE and RECENT sections filter by `activeWorkspaceFilter` when set.  
- `SidebarSearch` filters the combined session list by name (case-insensitive substring). Search takes precedence over workspace filter (shows results across all workspaces).

### Workspace session counts

`workspaceStore.ts` gains a derived selector `sessionCountByWorkspace(sessions)` that counts sessions per `workspaceId`. `WorkspaceList` reads this to render the count badge.

### Placeholder nav items

"Automations" and "Plugins" render with a small `soon` badge and no `onClick` handler. They are visually styled as disabled (muted colour).

### Files

| File | Action |
|---|---|
| `src/components/SessionRail.tsx` | **Deleted** |
| `src/components/Sidebar.tsx` | **Created** |
| `src/components/SidebarSearch.tsx` | **Created** |
| `src/components/SidebarNav.tsx` | **Created** |
| `src/components/WorkspaceList.tsx` | **Created** |
| `src/components/SessionGroup.tsx` | **Created** |
| `src/components/SessionRow.tsx` | **Created** |
| `src/components/Layout.tsx` | **Modified** — swap rail div for resizable Panel |
| `src/stores/workspaceStore.ts` | **Modified** — add `sessionCountByWorkspace` selector |

---

## 2. Header — Git Integration

### What changes

`AppHeader.tsx` gains three new display elements (branch name, diff stats, Commit button) and accepts a `gitStatus` prop. A new `useGitStatus` hook owns the polling logic. A new `CommitModal.tsx` handles the commit flow.

### Data flow

```
Layout.tsx
  useGitStatus(activeSession.workingDir)   ← polls every 5s
    → git_status Tauri command
    → { branch, added, removed, hasChanges }
  passes gitStatus prop to AppHeader
AppHeader
  renders branch + diff stats when gitStatus != null
  renders Commit button when gitStatus.hasChanges === true
  Commit button click → setShowCommit(true) → CommitModal
CommitModal
  text input for commit message
  on submit → git_commit Tauri command → closes modal
```

### Tauri commands (Rust)

```rust
// src-tauri/src/commands.rs

#[tauri::command]
async fn git_status(working_dir: String) -> Result<GitStatus, String>
// runs: git branch --show-current, git diff --stat HEAD
// returns: GitStatus { branch, added, removed, has_changes }

#[tauri::command]
async fn git_commit(working_dir: String, message: String) -> Result<(), String>
// runs: git add -A && git commit -m "{message}"
```

### Graceful degradation

If `git_status` errors (not a git repo, git not installed), `useGitStatus` returns `null`. When `gitStatus` is `null`, `AppHeader` renders exactly as today — no branch, no stats, no Commit button.

### Polling

`useGitStatus` uses `useEffect` + `setInterval(5000)`. It clears the interval when the working directory changes or the component unmounts. It does not poll when `workingDir` is undefined.

### Files

| File | Action |
|---|---|
| `src/hooks/useGitStatus.ts` | **Created** |
| `src/components/AppHeader.tsx` | **Modified** — gitStatus prop, branch/diff/Commit rendering |
| `src/components/CommitModal.tsx` | **Created** |
| `src/lib/tauri.ts` | **Modified** — add `gitStatus()` and `gitCommit()` wrappers |
| `src-tauri/src/commands.rs` | **Modified** — add `git_status` and `git_commit` commands |
| `src-tauri/src/lib.rs` | **Modified** — register new commands |

---

## 3. Right Panel

### What changes

The inline tab logic in `Layout.tsx` (currently "Code | Usage") is extracted into a new `RightPanel.tsx` with four tabs. A new `SummaryTab.tsx` provides session overview content. The three existing components slot in unchanged.

### Tab structure

| Tab | Component | Content | Badge |
|---|---|---|---|
| Summary | `SummaryTab.tsx` (new) | Session name, workspace, branch; plan progress; recent tool calls | — |
| Review | `FileChangesPanel.tsx` (existing, moved) | File diffs with Accept/Reject | Count of pending changes when > 0 |
| Code | `CodeViewer.tsx` (existing, moved) | File viewer | — |
| Usage | `TokenDashboard.tsx` (existing, moved) | Token/cost dashboard | — |

### SummaryTab content

Parsed from the session's existing `output` string in `sessionStore`:

- **Plan block:** Detects the `PLAN · N/M STEPS DONE` pattern already rendered in `TerminalPanel`. Extracts steps and their checked/unchecked state.
- **Recent tool calls:** Scans output lines for tool call markers (`Read`, `Write`, `Edit`, `Grep`, `Bash`) and lists the last 10.
- **Session metadata:** `session.name`, `session.workingDir` (basename), `gitStatus.branch` (passed as prop from Layout).

### Files

| File | Action |
|---|---|
| `src/components/RightPanel.tsx` | **Created** — tab bar + panel switcher |
| `src/components/SummaryTab.tsx` | **Created** — session overview |
| `src/components/Layout.tsx` | **Modified** — replace inline tab logic with `<RightPanel />` |

---

## 4. Layout.tsx — Final Structure

After all changes, the top-level structure of `Layout.tsx`:

```
<div className="h-full flex flex-col">
  <AppHeader gitStatus={gitStatus} … />
  <UpdateBanner />
  {/* version warning banner */}
  {/* rate limit banner */}

  <PanelGroup direction="horizontal" className="flex-1 min-h-0">

    {/* Sidebar */}
    {!sidebarCollapsed && (
      <>
        <Panel defaultSize={18} minSize={12} maxSize={28}>
          <Sidebar onOpenSettings={…} />
        </Panel>
        <PanelResizeHandle className={colHandle} />
      </>
    )}

    {/* Main content column */}
    <Panel>
      <PanelGroup direction="vertical">

        {/* Conversation + Right Panel row */}
        <Panel>
          <PanelGroup direction="horizontal">
            <Panel>
              <TerminalPanel … />
            </Panel>
            {activeSession && rightPanelVisible && (
              <>
                <PanelResizeHandle className={colHandle} />
                <Panel>
                  <RightPanel … />
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>

        {/* Terminal row */}
        {terminalVisible && activeSession && (
          <>
            <PanelResizeHandle className={rowHandle} />
            <Panel>
              <IntegratedTerminal … />
            </Panel>
          </>
        )}

      </PanelGroup>
    </Panel>

  </PanelGroup>

  <StatusBar />
</div>
```

Note: sidebar width is controlled by `react-resizable-panels` (percentage-based). The `defaultSize={18}` targets ~240px at a 1280px window width. Min/max are percentage equivalents of 160px/360px.

---

## 5. New File Summary

| File | Purpose |
|---|---|
| `src/components/Sidebar.tsx` | Full sidebar orchestrator |
| `src/components/SidebarSearch.tsx` | Search input |
| `src/components/SidebarNav.tsx` | All chats / Automations / Plugins |
| `src/components/WorkspaceList.tsx` | Workspace list with session counts |
| `src/components/SessionGroup.tsx` | ACTIVE / RECENT section container |
| `src/components/SessionRow.tsx` | Individual session row |
| `src/components/RightPanel.tsx` | Right panel tab container |
| `src/components/SummaryTab.tsx` | Session summary content |
| `src/components/CommitModal.tsx` | Git commit message modal |
| `src/hooks/useGitStatus.ts` | Git status poller |

**Modified:** `Layout.tsx`, `AppHeader.tsx`, `workspaceStore.ts`, `src/lib/tauri.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Deleted:** `src/components/SessionRail.tsx`

---

## 6. Out of Scope

- Automations and Plugins functionality (placeholders only)
- Notification bell in the header
- Search backend / server-side session search
- Session rename from the sidebar
- Branch switching from the header
