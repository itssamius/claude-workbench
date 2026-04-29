# Phase 7: Product Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce initial JS bundle size via code splitting, add inline recovery flows for every known failure mode, show a dirty-worktree badge in SessionRail, and ship a concrete architecture reference document.

**Architecture:** Code splitting uses `React.lazy` + `Suspense` in `App.tsx` so heavy page components are fetched on first navigation; Vite handles the chunk boundary automatically. Recovery flows are prop-threaded from `App.tsx` hooks into the exact UI surface where the failure occurs (conversation area, TitleBar, terminal panel) rather than reaching for a global toast. The dirty-worktree badge is driven by a `useWorktreeDirty` hook that polls `git_status_porcelain` on a 30 s interval and exposes a `Set<string>` of dirty session ids to `SessionRail`.

**Tech Stack:** React 18 (lazy/Suspense), TypeScript, Tauri 2

---

### Task 1: Code-split `SearchPage`, `AllChatsPage`, `ProjectPage`, `AutomationsPage`, `PluginsPage` and `SettingsOverlay`

**Files:**
- Edit: `src/App.tsx`

**Why:** `Pages.tsx`, `AutomationsPage.tsx`, `PluginsPage.tsx` and `Settings.tsx` are never rendered on cold start — the user sees the active conversation. Lazy-loading them trims the initial JS parse cost. Vite creates a separate chunk for each `React.lazy` import.

- [ ] **Step 1: Replace static page imports with `React.lazy` in `src/App.tsx`**

Find the current static imports at the top of `src/App.tsx`:

```typescript
import SettingsOverlay from './components/Settings';
import { AllChatsPage, SearchPage, ProjectPage } from './components/Pages';
import { AutomationsPage } from './components/AutomationsPage';
import { PluginsPage } from './components/PluginsPage';
```

Replace with:

```typescript
import { lazy, Suspense } from 'react';

const SettingsOverlay  = lazy(() => import('./components/Settings'));
const AllChatsPage     = lazy(() => import('./components/Pages').then(m => ({ default: m.AllChatsPage })));
const SearchPage       = lazy(() => import('./components/Pages').then(m => ({ default: m.SearchPage })));
const ProjectPage      = lazy(() => import('./components/Pages').then(m => ({ default: m.ProjectPage })));
const AutomationsPage  = lazy(() => import('./components/AutomationsPage').then(m => ({ default: m.AutomationsPage })));
const PluginsPage      = lazy(() => import('./components/PluginsPage').then(m => ({ default: m.PluginsPage })));
```

- [ ] **Step 2: Wrap every usage of a lazy component in `<Suspense>`**

In `App.tsx`, locate the render branch for each page view. Wrap each lazy component with a `Suspense` fallback that matches the shell background so there is no flash of white:

```tsx
// Example: search view branch
{view.kind === 'search' && (
  <Suspense fallback={<div style={{ flex: 1, background: 'var(--bg-paper)' }} />}>
    <SearchPage />
  </Suspense>
)}

// Example: all-chats view branch
{view.kind === 'all-chats' && (
  <Suspense fallback={<div style={{ flex: 1, background: 'var(--bg-paper)' }} />}>
    <AllChatsPage
      chats={allChatRows}
      onSelectActive={handleSelectActive}
      onRemoveChat={handleRemoveChat}
    />
  </Suspense>
)}

// Example: project view branch
{view.kind === 'project' && (
  <Suspense fallback={<div style={{ flex: 1, background: 'var(--bg-paper)' }} />}>
    <ProjectPage
      project={view.project}
      chats={projectChatRows}
      onSelectActive={handleSelectActive}
      onNewChat={handleNewTaskInProject}
      onRemoveChat={handleRemoveChat}
    />
  </Suspense>
)}

// Example: automations view branch
{view.kind === 'automations' && (
  <Suspense fallback={<div style={{ flex: 1, background: 'var(--bg-paper)' }} />}>
    <AutomationsPage ... />
  </Suspense>
)}

// Example: plugins view branch
{view.kind === 'plugins' && (
  <Suspense fallback={<div style={{ flex: 1, background: 'var(--bg-paper)' }} />}>
    <PluginsPage ... />
  </Suspense>
)}

// SettingsOverlay is conditionally rendered at root level
{settingsOpen && (
  <Suspense fallback={null}>
    <SettingsOverlay ... />
  </Suspense>
)}
```

- [ ] **Step 3: Verify build splits correctly**

```bash
npm run build 2>&1 | grep "\.js" | grep -E "Pages|Settings|AutomationsPage|PluginsPage"
```

Each lazy module must appear as its own chunk (e.g. `Pages-<hash>.js`). If they appear merged into `index.js` the `React.lazy` wrapping is incorrect.

- [ ] **Step 4: Run type check and tests**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `feat: code-split page components and settings overlay with React.lazy`

---

### Task 2: Inline recovery for worktree creation failure

**Files:**
- Edit: `src/App.tsx`
- Edit: `src/components/Conversation.tsx`

**Why:** When `invoke('create_worktree', ...)` throws, the error is currently either swallowed or shown in a toast. The user needs a contextual "Retry" button in the conversation area where they started the task.

- [ ] **Step 1: Add `worktreeError` to session state in `App.tsx`**

In the `SessionState` interface, add:

```typescript
/** Set when create_worktree throws; cleared on retry or session close. */
worktreeError?: string;
```

- [ ] **Step 2: Populate `worktreeError` in the new-task handler**

In `App.tsx`, in the function that creates a new session and calls `create_worktree`, change the catch block from a toast to setting `worktreeError` on the session:

```typescript
} catch (err) {
  const msg = typeof err === 'string' ? err : 'Could not create worktree. Is this directory a git repo?';
  setSessions(prev => prev.map(s =>
    s.id === newSessionId ? { ...s, worktreeError: msg, taskState: 'idle' } : s
  ));
  return; // do not proceed to start_task
}
```

- [ ] **Step 3: Add `worktreeError` + `onRetryWorktree` props to `Conversation`**

In `src/components/Conversation.tsx`, extend the `Props` interface:

```typescript
/** If set, worktree creation failed with this message; show inline recovery. */
worktreeError?: string;
/** Called when the user clicks "Retry" in the worktree error banner. */
onRetryWorktree?: () => void;
```

- [ ] **Step 4: Render the inline error banner in `Conversation`**

In the Conversation scroll area, just above the message list (`{messages.map(...)}`), add:

```tsx
{worktreeError && (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 16px',
      marginBottom: 16,
      background: 'var(--bg-panel)',
      border: '1px solid var(--red)',
      borderRadius: 10,
    }}
  >
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--red)',
        flexShrink: 0,
        marginTop: 4,
      }}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 13.5,
          color: 'var(--text)',
          marginBottom: 6,
          lineHeight: 1.45,
        }}
      >
        Worktree creation failed: {worktreeError}
      </div>
      {onRetryWorktree && (
        <button
          type="button"
          onClick={onRetryWorktree}
          style={{
            height: 28,
            padding: '0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text)',
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5: Wire `onRetryWorktree` in `App.tsx`**

Pass `worktreeError` and `onRetryWorktree` from the active session into `<Conversation>`:

```tsx
<Conversation
  ...
  worktreeError={activeSession.worktreeError}
  onRetryWorktree={() => handleRetryWorktree(activeSession.id)}
/>
```

`handleRetryWorktree` clears `worktreeError` on the session and calls `create_worktree` again, falling through to `start_task` on success.

- [ ] **Step 6: Run type check and tests**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `feat(recovery): show inline retry banner when worktree creation fails`

---

### Task 3: Inline recovery for commit failure

**Files:**
- Edit: `src/App.tsx`
- Edit: `src/components/TitleBar.tsx`

**Why:** When `CommitModal` calls `invoke('git_commit', ...)` and it fails, the user needs feedback near the Commit button where the action happened, not a global toast that competes with other messages.

- [ ] **Step 1: Add `commitError` to session state in `App.tsx`**

In `SessionState`:

```typescript
/** Set when git_commit throws; cleared when the user retries or dismisses. */
commitError?: string;
```

- [ ] **Step 2: Populate and clear `commitError` in the commit handler**

In the commit submit handler in `App.tsx`:

```typescript
try {
  await invoke('git_commit', { worktreePath: session.worktreePath, message });
  setSessions(prev => prev.map(s =>
    s.id === session.id ? { ...s, commitError: undefined } : s
  ));
  setCommitOpen(false);
} catch (err) {
  const msg = typeof err === 'string' ? err : 'git commit failed. Check that the worktree has staged changes.';
  setSessions(prev => prev.map(s =>
    s.id === session.id ? { ...s, commitError: msg } : s
  ));
  // leave CommitModal open so user can edit the message and retry
}
```

- [ ] **Step 3: Add `commitError` + `onDismissCommitError` props to `TitleBar`**

In `src/components/TitleBar.tsx`, extend `Props`:

```typescript
commitError?: string;
onDismissCommitError?: () => void;
```

- [ ] **Step 4: Render the commit error strip in `TitleBar`**

Below the existing titlebar `<div>` (i.e., as a sibling, wrapped in a fragment), render a thin error strip when `commitError` is set:

```tsx
export default function TitleBar({ ..., commitError, onDismissCommitError }: Props) {
  return (
    <>
      <div data-tauri-drag-region style={{ ... }}>
        {/* existing content unchanged */}
      </div>

      {commitError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 16px',
            background: '#3b0a0a',
            borderBottom: '1px solid var(--red)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: '#fca5a5',
          }}
        >
          <span style={{ flex: 1 }}>Commit failed: {commitError}</span>
          <button
            type="button"
            onClick={onDismissCommitError}
            style={{
              height: 22,
              padding: '0 10px',
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              color: '#fca5a5',
              background: 'transparent',
              border: '1px solid #7f1d1d',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Wire props in `App.tsx`**

```tsx
<TitleBar
  ...
  commitError={activeSession?.commitError}
  onDismissCommitError={() =>
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId ? { ...s, commitError: undefined } : s
    ))
  }
/>
```

- [ ] **Step 6: Run type check and tests**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `feat(recovery): show inline commit error strip in TitleBar`

---

### Task 4: Inline recovery for `start_task` failure (general + auth)

**Files:**
- Edit: `src/App.tsx`
- Edit: `src/components/Conversation.tsx`

**Why:** When `invoke('start_task', ...)` rejects (or emits an `Error` agent event immediately), the user is left with a spinning "thinking" indicator. Two sub-cases exist: (a) generic launch failure, (b) the Claude CLI is not logged in — detected by matching `"not logged in"` or `"claude auth"` in the error string.

- [ ] **Step 1: Add `taskError` to session state**

In `SessionState`:

```typescript
/**
 * Set when start_task throws or emits an immediate Error event.
 * `authRequired` is true when the message indicates the CLI is not authenticated.
 */
taskError?: { message: string; authRequired: boolean };
```

- [ ] **Step 2: Detect and populate `taskError` in the `start_task` call site**

In `App.tsx`, in the function that calls `invoke('start_task', ...)`:

```typescript
function isAuthError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('not logged in') || lower.includes('claude auth') || lower.includes('authentication');
}

try {
  await invoke('start_task', { ... });
} catch (err) {
  const message = typeof err === 'string' ? err : String(err);
  setSessions(prev => prev.map(s =>
    s.id === sessionId
      ? { ...s, isRunning: false, taskError: { message, authRequired: isAuthError(message) } }
      : s
  ));
}
```

Also handle the `Error` agent event (already received in the `listen('agent-event', ...)` handler). When `event.type === 'error'`, set `taskError` on the matching session instead of only setting `isRunning: false`.

- [ ] **Step 3: Add `taskError` + `onRetryTask` props to `Conversation`**

In `src/components/Conversation.tsx`, extend `Props`:

```typescript
taskError?: { message: string; authRequired: boolean };
onRetryTask?: () => void;
```

- [ ] **Step 4: Render the task error banner in `Conversation`**

In the scroll area, alongside the `worktreeError` banner added in Task 2 (they are mutually exclusive in practice — show whichever is set):

```tsx
{taskError && (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 16px',
      marginBottom: 16,
      background: 'var(--bg-panel)',
      border: '1px solid var(--red)',
      borderRadius: 10,
    }}
  >
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--red)',
        flexShrink: 0,
        marginTop: 4,
      }}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      {taskError.authRequired ? (
        <>
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13.5,
              color: 'var(--text)',
              marginBottom: 6,
              lineHeight: 1.45,
            }}
          >
            Claude CLI is not authenticated. Run this command in a terminal, then retry:
          </div>
          <code
            style={{
              display: 'block',
              padding: '6px 10px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text)',
              marginBottom: 8,
              userSelect: 'all',
            }}
          >
            claude auth login
          </code>
        </>
      ) : (
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13.5,
            color: 'var(--text)',
            marginBottom: 6,
            lineHeight: 1.45,
          }}
        >
          Claude failed to start: {taskError.message}
        </div>
      )}
      {onRetryTask && (
        <button
          type="button"
          onClick={onRetryTask}
          style={{
            height: 28,
            padding: '0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text)',
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5: Wire in `App.tsx`**

```tsx
<Conversation
  ...
  taskError={activeSession?.taskError}
  onRetryTask={() => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId ? { ...s, taskError: undefined } : s
    ));
    // Re-submit the last user message
    const lastUser = activeSession?.messages.findLast(m => m.role === 'user');
    if (lastUser?.content) handleSubmit(activeSession.id, lastUser.content);
  }}
/>
```

- [ ] **Step 6: Run type check and tests**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `feat(recovery): inline start_task error with auth detection and retry`

---

### Task 5: Inline recovery for terminal startup failure

**Files:**
- Edit: `src/components/Terminal.tsx`
- Edit: `src/components/TerminalPanel.tsx`

**Why:** When `invoke('term_create', ...)` fails inside `Terminal.tsx`, the terminal pane is blank and the user has no idea what happened. An inline error with a "Retry" button inside the terminal pane makes the failure self-describing.

- [ ] **Step 1: Capture and expose terminal creation error in `Terminal.tsx`**

Locate the `useEffect` in `Terminal.tsx` that calls `invoke('term_create', ...)`. Add error state:

```typescript
const [startError, setStartError] = useState<string | null>(null);

useEffect(() => {
  let cancelled = false;
  invoke<string>('term_create', { cwd })
    .then((id) => {
      if (cancelled) return;
      setStartError(null);
      onReady(id);
    })
    .catch((err) => {
      if (cancelled) return;
      setStartError(typeof err === 'string' ? err : 'Terminal failed to start.');
    });
  return () => { cancelled = true; };
}, [cwd]);
```

Render the error overlay when `startError` is set (instead of the xterm div):

```tsx
if (startError) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        background: '#1d1a14',
        padding: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#fca5a5',
          textAlign: 'center',
          lineHeight: 1.6,
          maxWidth: 360,
        }}
      >
        Terminal failed to start: {startError}
      </div>
      <button
        type="button"
        onClick={() => { setStartError(null); /* useEffect key trick below */ setRetryKey(k => k + 1); }}
        style={{
          height: 28,
          padding: '0 14px',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          color: '#fff',
          background: '#374151',
          border: '1px solid #4b5563',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}
```

Add a `retryKey` state so the `useEffect` can be re-triggered:

```typescript
const [retryKey, setRetryKey] = useState(0);

useEffect(() => {
  // ... existing term_create logic ...
}, [cwd, retryKey]); // add retryKey to deps
```

- [ ] **Step 2: Run type check and tests**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `feat(recovery): show inline error and retry button when terminal fails to start`

---

### Task 6: Dirty-worktree badge in `SessionRail`

**Files:**
- Create: `src/hooks/useWorktreeDirty.ts`
- Edit: `src/components/SessionRail.tsx`
- Edit: `src/App.tsx`

**Why:** Users need to see at a glance which sessions have uncommitted changes so they know to commit before switching or discarding.

- [ ] **Step 1: Create `src/hooks/useWorktreeDirty.ts`**

```typescript
/**
 * src/hooks/useWorktreeDirty.ts
 *
 * Polls git_status_porcelain every 30 s for each active session that has a
 * worktreePath. Returns a Set of session ids whose worktree is dirty.
 *
 * Polling stops automatically for a session when:
 *   - The session has no worktreePath (plain project session)
 *   - The session's taskState is 'stopped'
 */
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SessionStub {
  id: string;
  worktreePath?: string;
  taskState: string;
}

const POLL_INTERVAL_MS = 30_000;

export function useWorktreeDirty(sessions: SessionStub[]): Set<string> {
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  // Keep a stable ref to the sessions list so the interval callback always
  // sees the latest value without re-creating the interval.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    async function poll() {
      const next = new Set<string>();
      const toCheck = sessionsRef.current.filter(
        s => s.worktreePath && s.taskState !== 'stopped',
      );
      await Promise.allSettled(
        toCheck.map(async s => {
          try {
            // git_status_porcelain returns Vec<(file, status)>
            const entries = await invoke<Array<[string, string]>>(
              'git_status_porcelain',
              { projectPath: s.worktreePath },
            );
            if (entries.length > 0) next.add(s.id);
          } catch {
            // network / git failure — leave session out of dirty set
          }
        }),
      );
      setDirtyIds(next);
    }

    // Immediate first poll, then repeat
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []); // stable: sessionsRef.current handles session list changes

  return dirtyIds;
}
```

- [ ] **Step 2: Expose `dirtyWorktreeIds` through `SessionRail` props**

In `src/components/SessionRail.tsx`, add to `Props`:

```typescript
/** Session ids whose worktree currently has uncommitted changes. */
dirtyWorktreeIds?: Set<string>;
```

Pass it down to `ChatRow` via `isDirtyWorktree`:

```typescript
// In ActiveSession-rendering loop:
<ChatRow
  key={s.id}
  ...
  isDirtyWorktree={dirtyWorktreeIds?.has(s.id) ?? false}
  ...
/>
```

- [ ] **Step 3: Add `isDirtyWorktree` prop to `ChatRow` and render the badge**

Extend `ChatRow`'s prop list:

```typescript
isDirtyWorktree?: boolean;
```

In the `ChatRow` render, add the dirty badge to the text stack, after the title span and before the status subtext. The badge appears only when `isDirtyWorktree` is true and the session is not currently showing a `working`/`awaiting` subtext (those already communicate activity):

```tsx
{isDirtyWorktree && !subtext && (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      color: 'var(--amber)',
    }}
  >
    <span
      style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: 'var(--amber)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
    uncommitted
  </span>
)}
```

Place this between the title `<span>` and the `{subtext ? ... : ...}` block that renders the project/time line.

- [ ] **Step 4: Call the hook in `App.tsx` and pass results to `SessionRail`**

In `App.tsx`:

```typescript
import { useWorktreeDirty } from './hooks/useWorktreeDirty';

// Inside App component:
const dirtyWorktreeIds = useWorktreeDirty(sessions);
```

Pass to `<SessionRail>`:

```tsx
<SessionRail
  ...
  dirtyWorktreeIds={dirtyWorktreeIds}
/>
```

- [ ] **Step 5: Run type check and tests**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `feat: dirty-worktree badge in SessionRail via 30s git status polling`

---

### Task 7: Write `docs/architecture.md`

**Files:**
- Create: `docs/architecture.md`

**Why:** Operators and contributors need a single authoritative reference for how data is stored, how worktrees are managed, what YOLO mode means, and how to recover from a broken state.

- [ ] **Step 1: Write `docs/architecture.md` with the content below**

```markdown
# Claude Workbench — Architecture Reference

## Local data locations

All persistent state is stored under `~/.workbench/`. The directory is created
on first launch. No data is written to the project directory itself.

| File | Contents |
|---|---|
| `~/.workbench/profile.json` | User name, avatar colour, default model, YOLO mode toggle |
| `~/.workbench/appearance.json` | Theme (dark/light/system), font size, sidebar width |
| `~/.workbench/sessions.json` | Serialised session list (messages, tool calls, diff patches, terminal tabs, model selection) |
| `~/.workbench/automations.json` | User-defined automations (name, trigger, prompt template) |
| `~/.workbench/attachments/<session-id>/` | Pasted or dropped images saved as temporary files before being appended to a prompt |

Worktrees are stored inside the **project** directory (not `~/.workbench`):

```
<project>/.worktrees/wb-<id>/
```

This is intentional: worktrees must be siblings of the project's `.git` directory.

---

## Worktree lifecycle

Every new session creates an isolated git worktree so Claude can make changes
without touching the main working tree.

### 1. Creation

When the user starts a new chat (⌘N or "New chat"), the Rust command
`create_worktree` runs:

```
git worktree add -b wb/<id> <project>/.worktrees/wb-<id>
```

- `<id>` is a six-character random alphanumeric string generated by `short_id()`.
- The branch name is `wb/<id>`.
- The worktree is checked out at the same HEAD as the main tree.

If the project directory is not a git repository this command fails and the UI
shows an inline error in the conversation area with a Retry button.

### 2. Active use

Claude runs inside the worktree directory (`project_path` passed to `start_task`
points to the worktree, not the project root). All file reads and writes happen
there. The main working tree is untouched.

The SessionRail polls `git status --porcelain` on the worktree every 30 seconds.
A yellow dot ("uncommitted") appears on the session row when any changed files
are detected.

### 3. Commit

The user clicks "Commit" in the TitleBar. The CommitModal shows a diff summary
and a message field. On submit, the Rust command `git_commit` stages all changes
(`git add -A`) and creates a commit inside the worktree branch. The diff patch
shown in the ReviewPanel is generated from `git diff HEAD~1 HEAD`.

If the commit fails (e.g. nothing staged, no git user configured), an error
strip appears immediately below the TitleBar with a Dismiss button. The
CommitModal stays open so the user can correct and retry.

### 4. Discard

The user can discard changes via the "Discard" action in the CommitModal or
task menu. This calls `remove_worktree`:

```
git worktree remove --force <worktree-path>
```

The branch `wb/<id>` is **not** deleted by this command; it is left dangling.
Run the manual cleanup steps below if you need to reclaim space.

### 5. Cleanup

When a session is removed from the rail (click ×), the worktree is removed via
`remove_worktree`. The session entry is deleted from `sessions.json` on the
next save cycle (debounced, fires within 2 s).

---

## YOLO mode

YOLO mode is toggled in Settings → Safety. When **off** (the default):

- `Bash` / shell tool calls require explicit permission before executing.
- `Write` and `Edit` tool calls are executed without a permission prompt.
- Network fetch calls (`WebFetch`, `WebSearch`) execute without a prompt.
- The permission modal shows the exact command, file path, and a risk label
  (`low` / `medium` / `high`) derived from the tool type.

When YOLO mode is **on**:

- All tool calls execute immediately with no permission prompt.
- The audit log in `sessions.json` still records every tool call and its output.
- **Risk:** Claude can run arbitrary shell commands without human review.
  Only enable YOLO mode in isolated environments or when you trust the full
  task prompt and any files Claude might read.

The YOLO setting is stored in `~/.workbench/profile.json` as:

```json
{ "yolo": true }
```

It takes effect for the **next** task started after the setting is saved.
Tasks already running are not affected.

---

## Safety mode defaults

| Tool | Default behaviour |
|---|---|
| `Read` | Always allowed — no prompt |
| `List` / `Glob` / `Grep` | Always allowed — no prompt |
| `Write` (new file) | Allowed — no prompt |
| `Edit` (existing file) | Allowed — no prompt |
| `Bash` / shell | **Blocked** — requires permission prompt |
| `WebFetch` | Allowed — no prompt |
| `WebSearch` | Allowed — no prompt |

The permission modal exposes three choices:

- **Allow once** — approve this specific invocation, prompt again next time.
- **Allow for session** — approve all calls with the same tool + path prefix for
  the life of this session.
- **Deny** — reject this call; Claude receives a `permission denied` error and
  may try a different approach.

---

## Manual worktree cleanup

If the app crashes mid-session or worktrees accumulate, clean them up manually:

```bash
# List all worktrees for a project
cd /path/to/project
git worktree list

# Remove a specific worktree (safe even if it has uncommitted changes)
git worktree remove --force .worktrees/wb-<id>

# Remove the dangling branch left behind
git branch -D wb/<id>

# Prune stale worktree references (after deleting the directory manually)
git worktree prune

# Remove the entire .worktrees directory if you want to clean everything
rm -rf .worktrees
git worktree prune
```

After cleanup, restart Claude Workbench. Sessions whose worktree directories no
longer exist will show a "worktree missing" error if you try to resume them.
Remove those sessions from the rail (×) to clear them from `sessions.json`.
```

- [ ] **Step 2: Verify the file renders without broken markdown**

```bash
npx markdownlint docs/architecture.md --disable MD013 MD033 || true
```

(MD013 line-length and MD033 inline HTML are acceptable here; treat other
failures as real errors.)

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit && npm test -- --run
```

**Commit:** `docs: add architecture.md covering data locations, worktree lifecycle, YOLO mode, and cleanup`

---

## Verification checklist

After all tasks are committed, verify the following manually before shipping:

- [ ] Open the app cold; DevTools Network shows `Pages-<hash>.js` is **not** fetched until you navigate to All Chats or Search.
- [ ] Simulate a worktree creation failure by passing a non-git path as the project; the conversation area shows the error banner with a working Retry button.
- [ ] Simulate a commit failure by committing with no staged changes; the TitleBar error strip appears and the CommitModal stays open.
- [ ] Set `ANTHROPIC_API_KEY` to an invalid value and start a task; the conversation area shows the auth recovery message with `claude auth login` code block.
- [ ] Kill the PTY backend manually; the terminal pane shows the error overlay with a Retry button that respawns the terminal.
- [ ] Edit a file in a worktree without committing; within 30 s the session row in the rail shows the yellow dot. Commit the change; the dot disappears within 30 s.
- [ ] `docs/architecture.md` is navigable and all code blocks are syntactically correct.
