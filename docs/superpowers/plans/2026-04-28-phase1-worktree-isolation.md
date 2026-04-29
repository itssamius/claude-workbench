# Phase 1: Worktree Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Claude task runs inside a dedicated git worktree so its file changes are isolated from the project's main working tree until the user explicitly commits or discards them.

**Architecture:** On `handleSubmit`, the frontend calls `create_worktree` before `start_task`; the returned `worktreePath` is stored in `SessionState` and passed as the cwd override to `run_agent`. When the agent finishes (Done / Error / Stopped), the frontend calls `remove_worktree` to prune the working directory and the branch. Commit and Discard operations run `git -C <worktreePath>` rather than `git -C <projectPath>`, scoping them to the worktree. A new `merge_worktree_branch` command lets the user merge the committed worktree branch back into the project's current branch after a successful commit.

**Tech Stack:** Tauri 2, Rust (tokio, serde_json), React 18, TypeScript

---

### Task 1: Add `list_worktrees` and `prune_worktrees` Rust commands

**Files:**
- Modify: `src-tauri/src/lib.rs:622-674` (worktree management section)

- [ ] **Step 1: Add `WorktreeEntry` struct and `list_worktrees` command**

Insert the following after the closing `}` of `remove_worktree` (currently line 674), before the `// ── Automations persistence` comment:

```rust
#[derive(Serialize)]
struct WorktreeEntry {
    path: String,
    branch: String,
    locked: bool,
}

/// Parse `git worktree list --porcelain` and return a structured list.
/// Each stanza is separated by a blank line and looks like:
///
/// ```
/// worktree /abs/path
/// HEAD <sha>
/// branch refs/heads/wb/abc123
/// ```
///
/// Bare worktrees and detached HEADs produce no `branch` line; those are
/// included with an empty `branch` string. Locked worktrees have a `locked`
/// line (optionally followed by a reason).
#[tauri::command]
async fn list_worktrees(project_path: String) -> Result<Vec<WorktreeEntry>, String> {
    let output = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git worktree list: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<WorktreeEntry> = Vec::new();

    // Split on blank lines to get one stanza per worktree.
    for stanza in text.split("\n\n") {
        let stanza = stanza.trim();
        if stanza.is_empty() {
            continue;
        }
        let mut path = String::new();
        let mut branch = String::new();
        let mut locked = false;

        for line in stanza.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = p.trim().to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                // "branch refs/heads/wb/abc123" → "wb/abc123"
                branch = b.trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(b.trim())
                    .to_string();
            } else if line.starts_with("locked") {
                locked = true;
            }
        }

        if !path.is_empty() {
            entries.push(WorktreeEntry { path, branch, locked });
        }
    }

    Ok(entries)
}

/// Run `git worktree prune` in the given project to remove stale metadata
/// for worktrees whose directories no longer exist on disk.
#[tauri::command]
async fn prune_worktrees(project_path: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git worktree prune: {e}"))?;

    if !output.status.success() {
        // Non-fatal: prune failure should not block startup.
        // Return Ok so the caller can continue.
        eprintln!(
            "git worktree prune warning: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}
```

- [ ] **Step 2: Register the two new commands in the `invoke_handler!` macro**

In `pub fn run()` (line ~1161), the `tauri::generate_handler!` array currently ends with:
```rust
            git_status_porcelain,
            term::term_open,
```

Add `list_worktrees` and `prune_worktrees` after `remove_worktree`:
```rust
            create_worktree,
            remove_worktree,
            list_worktrees,
            prune_worktrees,
```

- [ ] **Step 3: Verify Rust still compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): add list_worktrees and prune_worktrees commands"
```

---

### Task 2: Add `merge_worktree_branch` Rust command and scope `git_commit` / `git_discard` to worktree path

**Files:**
- Modify: `src-tauri/src/lib.rs:574-620` (`git_commit` and `git_discard` functions)

- [ ] **Step 1: Replace `git_commit` with a worktree-scoped version**

Current `git_commit` signature (line 574):
```rust
async fn git_commit(project_path: String, message: String) -> Result<(), String> {
```

Replace the entire function body with:
```rust
#[tauri::command]
async fn git_commit(worktree_path: String, message: String) -> Result<(), String> {
    let add = std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
    }

    let commit = std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !commit.status.success() {
        return Err(String::from_utf8_lossy(&commit.stderr).trim().to_string());
    }

    Ok(())
}
```

- [ ] **Step 2: Replace `git_discard` with a worktree-scoped version**

Current `git_discard` signature (line 597):
```rust
async fn git_discard(project_path: String) -> Result<(), String> {
```

Replace the entire function body with:
```rust
#[tauri::command]
async fn git_discard(worktree_path: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["checkout", "--", "."])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let clean = std::process::Command::new("git")
        .args(["clean", "-fd", "."])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !clean.status.success() {
        return Err(String::from_utf8_lossy(&clean.stderr).trim().to_string());
    }

    Ok(())
}
```

- [ ] **Step 3: Add `merge_worktree_branch` command**

Insert the following after the closing `}` of `git_discard` and before the `// ── Worktree management` comment:

```rust
/// Merge `branch` into the project's current branch using a fast-forward
/// if possible, otherwise a merge commit. Runs entirely in `project_path`
/// (the main worktree), not inside the worktree directory.
#[tauri::command]
async fn merge_worktree_branch(project_path: String, branch: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["merge", "--no-ff", &branch, "-m", &format!("Merge worktree branch {branch}")])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git merge: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "git merge failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(())
}
```

- [ ] **Step 4: Register `merge_worktree_branch` in the `invoke_handler!` macro**

Add it after `prune_worktrees`:
```rust
            prune_worktrees,
            merge_worktree_branch,
```

- [ ] **Step 5: Verify Rust still compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): scope git_commit/git_discard to worktree_path; add merge_worktree_branch"
```

---

### Task 3: Thread `worktree_path` through `start_task` and `run_agent`

**Files:**
- Modify: `src-tauri/src/lib.rs:159-167` (`run_agent` signature)
- Modify: `src-tauri/src/lib.rs:436-455` (`start_task` command)

- [ ] **Step 1: Update `run_agent` to accept `worktree_path` and run Claude inside it**

Replace the current `run_agent` signature and the `command` setup block (lines 159–196) with:

```rust
async fn run_agent(
    app: AppHandle,
    task_id: String,
    project_path: String,
    worktree_path: String,
    prompt: String,
    resume_session: Option<String>,
    model: Option<String>,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    // Use the user's login shell so nvm/homebrew/npm PATH shims are loaded.
    // The prompt and (optional) resume id are passed via env vars to avoid
    // any shell injection. `--resume` only appears when $_WBRESUME is set.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // Build argv as positional params so each token is a distinct argv entry —
    // avoids shell collapsing `--resume "$id"` into one word inside `${var:+…}`.
    let cmd = "set -- --print --verbose --output-format stream-json \
               --include-partial-messages \
               --dangerously-skip-permissions; \
               if [ -n \"$_WBRESUME\" ]; then set -- \"$@\" --resume \"$_WBRESUME\"; fi; \
               if [ -n \"$_WBMODEL\" ];  then set -- \"$@\" --model \"$_WBMODEL\"; fi; \
               set -- \"$@\" \"$_WBPROMPT\"; \
               exec claude \"$@\"";

    let mut command = Command::new(&shell);
    command
        .args(["-l", "-c", cmd])
        // Claude runs with the worktree as its working directory so all file
        // edits land in the isolated worktree, not the project root.
        .current_dir(&worktree_path)
        .env("_WBPROMPT", &prompt)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(sid) = resume_session.as_deref() {
        command.env("_WBRESUME", sid);
    }
    if let Some(m) = model.as_deref() {
        if !m.is_empty() { command.env("_WBMODEL", m); }
    }
```

- [ ] **Step 2: Update diff emission in `run_agent` to use `worktree_path`**

The two `git diff HEAD` calls (at line ~392 and ~419) currently use `&project_path`. Replace both `.current_dir(&project_path)` with `.current_dir(&worktree_path)` so the diff reflects the worktree's uncommitted changes:

At the cancelled branch (around line 392):
```rust
        if let Ok(diff_out) = std::process::Command::new("git")
            .args(["diff", "HEAD"])
            .current_dir(&worktree_path)
            .output()
```

At the completion branch (around line 419):
```rust
    if let Ok(diff_out) = std::process::Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&worktree_path)
        .output()
```

- [ ] **Step 3: Update `start_task` to accept and forward `worktree_path`**

Replace the current `start_task` function (lines 435–455) with:

```rust
#[tauri::command]
async fn start_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    project_path: String,
    worktree_path: String,
    prompt: String,
    resume_session: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.tasks.lock().await.insert(task_id.clone(), cancel_tx);
    let tasks = state.tasks.clone();
    let tid = task_id.clone();
    tokio::spawn(async move {
        run_agent(app, task_id, project_path, worktree_path, prompt, resume_session, model, cancel_rx).await;
        // Remove from registry once done (natural completion or cancel)
        tasks.lock().await.remove(&tid);
    });
    Ok(())
}
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): thread worktree_path through start_task and run_agent"
```

---

### Task 4: Wire worktree creation into `handleSubmit` in `App.tsx`

**Files:**
- Modify: `src/App.tsx:644-897` (`handleSubmit` function)

The goal: before calling `invoke('start_task', …)`, call `create_worktree` and store the result in the session. If creation fails, surface an error message and do not proceed.

- [ ] **Step 1: Replace the `invoke('start_task', …)` call block inside `handleSubmit`**

The current block (lines 864–896) is:

```typescript
    try {
      // Look up the (possibly just-set) Claude Code session id for this
      // session and pass it as `--resume` so the conversation continues.
      // First turn: undefined → fresh session, id captured from output.
      const liveSession = sessions.find(s => s.id === sessionId);
      const resumeId = liveSession?.claudeSessionId;
      const model    = liveSession?.model ?? DEFAULT_MODEL;
      await invoke('start_task', {
        taskId: sessionId,
        projectPath: workDir,
        prompt,
        resumeSession: resumeId ?? null,
        model,
      });
    } catch (err) {
```

Replace it with:

```typescript
    try {
      // Look up the (possibly just-set) Claude Code session id for this
      // session and pass it as `--resume` so the conversation continues.
      // First turn: undefined → fresh session, id captured from output.
      const liveSession = sessions.find(s => s.id === sessionId);
      const resumeId = liveSession?.claudeSessionId;
      const model    = liveSession?.model ?? DEFAULT_MODEL;

      // Determine the project path (always the project root, not the worktree).
      // `workDir` may equal a previous worktree path on a resumed session; we
      // resolve the real project root from the projects list.
      const sessionProject = liveSession?.project ?? '';
      const projectRoot = projects.find(p => p.name === sessionProject)?.path ?? workDir;

      // On the first turn of a session there is no worktree yet. Create one now
      // so Claude runs in isolation. On subsequent turns (resumeId is set) the
      // existing worktree is reused — it was stored in the session already.
      let resolvedWorktreePath: string;
      if (!resumeId) {
        // First turn: create a fresh worktree.
        let worktreeInfo: { path: string; branch: string };
        try {
          worktreeInfo = await invoke<{ path: string; branch: string }>('create_worktree', {
            projectPath: projectRoot,
          });
        } catch (wtErr) {
          // Worktree creation failed — surface the error and abort.
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              isRunning: false,
              taskState: 'idle' as const,
              messages: [...s.messages, {
                id: `msg-err-${Date.now()}`,
                role: 'assistant' as const,
                author: 'Claude',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: `Failed to create worktree: ${String(wtErr)}`,
              }],
            };
          }));
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          return;
        }

        // Store the worktree path and branch in the session so Commit/Reject
        // and subsequent turns know where to operate.
        updateSession(sessionId, {
          worktreePath: worktreeInfo.path,
          worktreeBranch: worktreeInfo.branch,
        });
        resolvedWorktreePath = worktreeInfo.path;
      } else {
        // Subsequent turn: reuse the existing worktree that was created on the
        // first turn. Fall back to projectRoot if somehow it is missing.
        resolvedWorktreePath = liveSession?.worktreePath ?? projectRoot;
      }

      await invoke('start_task', {
        taskId: sessionId,
        projectPath: projectRoot,
        worktreePath: resolvedWorktreePath,
        prompt,
        resumeSession: resumeId ?? null,
        model,
      });
    } catch (err) {
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0 with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): create worktree before start_task; store path+branch in session"
```

---

### Task 5: Auto-remove worktree on session Done / Error / Stopped

**Files:**
- Modify: `src/App.tsx:804-858` (the `done`, `stopped`, and `error` cases of the `agent-event` listener inside `handleSubmit`)

The worktree must be pruned when the agent finishes. We call `remove_worktree` after each terminal event. The call is fire-and-forget (the worktree directory is already useless once the session ends).

- [ ] **Step 1: Add `remove_worktree` call to the `done` case**

Current `done` case body (line ~804):
```typescript
        case 'done': {
          flushTokens();
          setSessions(prev => {
```

Replace with:
```typescript
        case 'done': {
          flushTokens();
          // Prune the worktree now that the task is complete. The user has
          // already committed or the diff is shown for review; the worktree
          // directory itself is no longer needed.
          setSessions(prev => {
            const s = prev.find(s => s.id === sessionId);
            if (s?.worktreePath) {
              const projectRoot = projects.find(p => p.name === s.project)?.path ?? s.worktreePath;
              invoke('remove_worktree', { projectPath: projectRoot, worktreePath: s.worktreePath }).catch(() => {});
            }
            return prev;
          });
          setSessions(prev => {
```

- [ ] **Step 2: Add `remove_worktree` call to the `stopped` case**

Current `stopped` case body (line ~830):
```typescript
        case 'stopped': {
          flushTokens();
          updateSession(sessionId, { isRunning: false, taskState: 'idle', lastActivityAt: Date.now(), currentTool: null, streamingText: false });
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
```

Replace with:
```typescript
        case 'stopped': {
          flushTokens();
          // Prune the worktree after a cancelled task.
          setSessions(prev => {
            const s = prev.find(s => s.id === sessionId);
            if (s?.worktreePath) {
              const projectRoot = projects.find(p => p.name === s.project)?.path ?? s.worktreePath;
              invoke('remove_worktree', { projectPath: projectRoot, worktreePath: s.worktreePath }).catch(() => {});
            }
            return prev;
          });
          updateSession(sessionId, { isRunning: false, taskState: 'idle', lastActivityAt: Date.now(), currentTool: null, streamingText: false });
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
```

- [ ] **Step 3: Add `remove_worktree` call to the `error` case**

Current `error` case body (line ~837):
```typescript
        case 'error': {
          flushTokens();
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              isRunning: false,
              taskState: 'idle',
              currentTool: null,
              streamingText: false,
              messages: [...s.messages, {
                id: `msg-err-${Date.now()}`,
                role: 'assistant' as const,
                author: 'Claude',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: `Error: ${ev.message}`,
              }],
            };
          }));
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
```

Replace with:
```typescript
        case 'error': {
          flushTokens();
          setSessions(prev => prev.map(s => {
            if (s.id !== sessionId) return s;
            // Prune the worktree on error — no useful changes to keep.
            if (s.worktreePath) {
              const projectRoot = projects.find(p => p.name === s.project)?.path ?? s.worktreePath;
              invoke('remove_worktree', { projectPath: projectRoot, worktreePath: s.worktreePath }).catch(() => {});
            }
            return {
              ...s,
              isRunning: false,
              taskState: 'idle',
              currentTool: null,
              streamingText: false,
              messages: [...s.messages, {
                id: `msg-err-${Date.now()}`,
                role: 'assistant' as const,
                author: 'Claude',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                content: `Error: ${ev.message}`,
              }],
            };
          }));
          unlisten();
          unlistensBySessionRef.current.delete(sessionId);
          break;
        }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): remove_worktree automatically on done/stopped/error"
```

---

### Task 6: Call `prune_worktrees` once per project on app startup

**Files:**
- Modify: `src/App.tsx:256-295` (profile load `useEffect`)

On startup, after the profile and projects list are resolved, we call `prune_worktrees` for every known project. This cleans up orphaned worktree metadata from previous runs that may not have had a chance to call `remove_worktree` (e.g. the app was force-quit).

- [ ] **Step 1: Add `prune_worktrees` call inside the profile load `useEffect`**

The current profile `useEffect` (lines 257–295) ends with:
```typescript
      // Mark onboarding done if we have a project path
      setOnboardingDone(!!profile.projectPath);
      return;
    } catch {}
  }
  // Fall back to localStorage gate check
  setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
```

Replace the `setOnboardingDone(!!profile.projectPath); return;` block with:

```typescript
      // Mark onboarding done if we have a project path
      setOnboardingDone(!!profile.projectPath);

      // Best-effort: prune stale worktree metadata for all known projects.
      // Run after a short delay so the UI doesn't block on startup.
      const pathsToPrune: string[] = [];
      if (Array.isArray(profile.projects)) {
        for (const p of profile.projects) {
          if (typeof p.path === 'string' && p.path) pathsToPrune.push(p.path);
        }
      } else if (profile.projectPath) {
        pathsToPrune.push(profile.projectPath);
      }
      for (const p of pathsToPrune) {
        invoke('prune_worktrees', { projectPath: p }).catch(() => {});
      }
      return;
    } catch {}
  }
  // Fall back to localStorage gate check
  setOnboardingDone(localStorage.getItem('workbench-profile') !== null);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(frontend): prune stale worktrees for all projects on app startup"
```

---

### Task 7: Disable Commit/Reject buttons when no worktree is present

**Files:**
- Modify: `src/components/TitleBar.tsx` (add `worktreeReady` prop)
- Modify: `src/App.tsx:1252-1260` (TitleBar usage)

Currently the Commit button is always enabled. It must be disabled when `currentSession.worktreePath` is null or undefined (i.e. the session has not yet run a task and has no worktree).

- [ ] **Step 1: Add `worktreeReady` and `onReject` props to `TitleBar`**

Current `Props` interface in `src/components/TitleBar.tsx` (lines 4–12):
```typescript
interface Props {
  project: string;
  branch: string;
  additions: number;
  deletions: number;
  onCommit: () => void;
  panelCollapsed?: boolean;
  onTogglePanel?: () => void;
}
```

Replace with:
```typescript
interface Props {
  project: string;
  branch: string;
  additions: number;
  deletions: number;
  onCommit: () => void;
  onReject: () => void;
  /** True only when the active session has an isolated worktree assigned. */
  worktreeReady: boolean;
  panelCollapsed?: boolean;
  onTogglePanel?: () => void;
}
```

- [ ] **Step 2: Update `TitleBar` function signature and button rendering**

Current function signature (line 18):
```typescript
export default function TitleBar({ project, branch, additions, deletions, onCommit, panelCollapsed, onTogglePanel }: Props) {
```

Replace with:
```typescript
export default function TitleBar({ project, branch, additions, deletions, onCommit, onReject, worktreeReady, panelCollapsed, onTogglePanel }: Props) {
```

Replace the right-actions `<div>` (lines 84–128) with:
```typescript
      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...noDrag }}>
        <button
          type="button"
          onClick={onTogglePanel}
          title={panelCollapsed ? 'Show side panel' : 'Hide side panel'}
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: panelCollapsed ? 'transparent' : 'var(--bg-panel)',
            border: '1px solid',
            borderColor: panelCollapsed ? 'transparent' : 'var(--border)',
            color: panelCollapsed ? 'var(--text-mute)' : 'var(--text-dim)',
            cursor: 'pointer',
            borderRadius: 6,
            marginRight: 4,
          }}
        >
          <PanelRight size={14} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={!worktreeReady}
          title={worktreeReady ? 'Discard changes' : 'No active worktree'}
          style={{
            height: 28,
            padding: '0 10px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: worktreeReady ? 'var(--red)' : 'var(--text-mute)',
            background: 'transparent',
            border: '1px solid',
            borderColor: worktreeReady ? 'var(--red)' : 'var(--border)',
            borderRadius: 6,
            cursor: worktreeReady ? 'pointer' : 'not-allowed',
            opacity: worktreeReady ? 1 : 0.4,
            whiteSpace: 'nowrap',
          }}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={!worktreeReady}
          title={worktreeReady ? 'Commit changes' : 'No active worktree'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            padding: '0 10px 0 12px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: worktreeReady ? '#fff' : 'var(--text-mute)',
            background: worktreeReady ? 'var(--green)' : 'var(--bg-paper)',
            border: '1px solid',
            borderColor: worktreeReady ? 'var(--green)' : 'var(--border)',
            borderRadius: 6,
            cursor: worktreeReady ? 'pointer' : 'not-allowed',
            opacity: worktreeReady ? 1 : 0.4,
            whiteSpace: 'nowrap',
          }}
        >
          Commit
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      </div>
```

- [ ] **Step 3: Update `TitleBar` usage in `App.tsx`**

The current `<TitleBar …>` call (lines 1252–1260):
```typescript
      <TitleBar
        project={activeProjectName}
        branch={activeBranch}
        additions={diffPatch ? diffStats(diffPatch).additions : 0}
        deletions={diffPatch ? diffStats(diffPatch).deletions : 0}
        onCommit={handleCommit}
        panelCollapsed={currentSession?.panelCollapsed ?? true}
        onTogglePanel={() => setPanelCollapsed(!(currentSession?.panelCollapsed ?? true))}
      />
```

Replace with:
```typescript
      <TitleBar
        project={activeProjectName}
        branch={activeBranch}
        additions={diffPatch ? diffStats(diffPatch).additions : 0}
        deletions={diffPatch ? diffStats(diffPatch).deletions : 0}
        onCommit={handleCommit}
        onReject={handleReject}
        worktreeReady={!!currentSession?.worktreePath}
        panelCollapsed={currentSession?.panelCollapsed ?? true}
        onTogglePanel={() => setPanelCollapsed(!(currentSession?.panelCollapsed ?? true))}
      />
```

- [ ] **Step 4: Update `doCommit` and `doReject` to use `worktreePath` directly**

The current `doCommit` (lines 1148–1157):
```typescript
  async function doCommit(message: string) {
    const workDir = currentSession?.worktreePath ?? projectPath;
    try {
      await invoke('git_commit', { projectPath: workDir, message });
    } catch (err) {
      console.error('git commit failed:', err);
    }
    updateSession(activeSessionId, { diffPatch: '' });
    setShowCommitModal(false);
  }
```

The `git_commit` command now expects `worktreePath` (not `projectPath`). Replace the invoke call:
```typescript
  async function doCommit(message: string) {
    if (!currentSession?.worktreePath) return;
    try {
      await invoke('git_commit', { worktreePath: currentSession.worktreePath, message });
    } catch (err) {
      console.error('git commit failed:', err);
    }
    updateSession(activeSessionId, { diffPatch: '' });
    setShowCommitModal(false);
  }
```

The current `doReject` (lines 1163–1172):
```typescript
  async function doReject() {
    const workDir = currentSession?.worktreePath ?? projectPath;
    try {
      await invoke('git_discard', { projectPath: workDir });
    } catch (err) {
      console.error('git discard failed:', err);
    }
    updateSession(activeSessionId, { diffPatch: '' });
    setShowRejectConfirm(false);
  }
```

Replace the invoke call:
```typescript
  async function doReject() {
    if (!currentSession?.worktreePath) return;
    try {
      await invoke('git_discard', { worktreePath: currentSession.worktreePath });
    } catch (err) {
      console.error('git discard failed:', err);
    }
    updateSession(activeSessionId, { diffPatch: '' });
    setShowRejectConfirm(false);
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/TitleBar.tsx src/App.tsx
git commit -m "feat(frontend): disable Commit/Reject when no worktree; add Reject button to TitleBar"
```

---

### Task 8: Add Merge UI after successful commit

**Files:**
- Create: `src/components/MergePromptModal.tsx`
- Modify: `src/App.tsx` (state, `doCommit`, modal rendering)

After a commit inside the worktree, offer the user the option to merge the worktree branch into the project's current branch so the work propagates back to the main checkout.

- [ ] **Step 1: Create `MergePromptModal.tsx`**

```typescript
// src/components/MergePromptModal.tsx
interface Props {
  branch: string;
  targetBranch: string;
  onMerge: () => void;
  onSkip: () => void;
}

export default function MergePromptModal({ branch, targetBranch, onMerge, onSkip }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 340,
          background: 'var(--bg-paper)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          padding: 20,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            marginBottom: 8,
          }}
        >
          Merge into {targetBranch}?
        </div>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-dim)',
            lineHeight: 1.55,
            marginBottom: 16,
          }}
        >
          Changes were committed to <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{branch}</code>.
          Merge that branch into <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{targetBranch}</code> now?
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onSkip}
            style={{
              height: 30,
              padding: '0 14px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              background: 'transparent',
              color: 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onMerge}
            style={{
              height: 30,
              padding: '0 14px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Import `MergePromptModal` and add merge state to `App.tsx`**

At the top of `App.tsx`, after the existing modal imports:
```typescript
import MergePromptModal from './components/MergePromptModal';
```

Inside `App()`, after `const [showRejectConfirm, setShowRejectConfirm] = useState(false);`:
```typescript
  const [mergePrompt, setMergePrompt] = useState<{
    worktreeBranch: string;
    projectBranch: string;
    projectPath: string;
  } | null>(null);
```

- [ ] **Step 3: Update `doCommit` to show the merge prompt after a successful commit**

Replace the updated `doCommit` from Task 7 with:
```typescript
  async function doCommit(message: string) {
    if (!currentSession?.worktreePath) return;
    try {
      await invoke('git_commit', { worktreePath: currentSession.worktreePath, message });
    } catch (err) {
      console.error('git commit failed:', err);
      setShowCommitModal(false);
      return;
    }
    updateSession(activeSessionId, { diffPatch: '' });
    setShowCommitModal(false);

    // Offer to merge the worktree branch back into the project's current branch.
    const sess = sessions.find(s => s.id === activeSessionId);
    if (sess?.worktreeBranch) {
      const activeProject = projects.find(p => p.name === sess.project);
      const projectPath = activeProject?.path ?? projectPath;
      let currentBranch = 'main';
      try {
        currentBranch = await invoke<string>('get_current_branch', { projectPath });
      } catch {
        // non-fatal; use fallback
      }
      setMergePrompt({
        worktreeBranch: sess.worktreeBranch,
        projectBranch: currentBranch,
        projectPath,
      });
    }
  }
```

Note: `projectPath` inside the function refers to `activeProject?.path ?? projectPath` where the outer `projectPath` is the state variable. To avoid name collision, use:
```typescript
      const projectRootPath = activeProject?.path ?? projectPath;
      let currentBranch = 'main';
      try {
        currentBranch = await invoke<string>('get_current_branch', { projectPath: projectRootPath });
      } catch {
        // non-fatal; use fallback
      }
      setMergePrompt({
        worktreeBranch: sess.worktreeBranch,
        projectBranch: currentBranch,
        projectPath: projectRootPath,
      });
```

- [ ] **Step 4: Add `doMerge` handler**

After `doReject`, add:
```typescript
  async function doMerge() {
    if (!mergePrompt) return;
    try {
      await invoke('merge_worktree_branch', {
        projectPath: mergePrompt.projectPath,
        branch: mergePrompt.worktreeBranch,
      });
    } catch (err) {
      console.error('merge_worktree_branch failed:', err);
    }
    setMergePrompt(null);
  }
```

- [ ] **Step 5: Render `MergePromptModal` in the JSX**

After the `{showRejectConfirm && <ConfirmModal … />}` block (around line 1469), add:
```typescript
      {mergePrompt && (
        <MergePromptModal
          branch={mergePrompt.worktreeBranch}
          targetBranch={mergePrompt.projectBranch}
          onMerge={doMerge}
          onSkip={() => setMergePrompt(null)}
        />
      )}
```

- [ ] **Step 6: Verify TypeScript compiles and Vite builds**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/MergePromptModal.tsx src/App.tsx
git commit -m "feat(frontend): add MergePromptModal; offer merge after worktree commit"
```

---

### Task 9: Fix `handleNewTask` and `handleAutomationRun` — clear stale worktree fields

**Files:**
- Modify: `src/App.tsx:915-958` (`handleNewTask`)
- Modify: `src/App.tsx:1092-1141` (`handleAutomationRun`)

Currently both functions set `worktreePath: target.path` (the project root) on the new session. After this phase, `worktreePath` must only be set by `create_worktree`. A new session starts with `worktreePath: undefined`; the worktree is assigned in `handleSubmit`.

- [ ] **Step 1: Update `handleNewTask` to leave `worktreePath` undefined**

In `handleNewTask`, the `newSession` object currently includes:
```typescript
      worktreePath: target.path,
      worktreeBranch: branch || undefined,
```

Replace with:
```typescript
      worktreePath: undefined,
      worktreeBranch: undefined,
```

Also remove the `get_current_branch` call that was only used to populate `worktreeBranch` at session creation time — the branch is now captured when the worktree is created. Remove these lines from `handleNewTask`:

```typescript
    // Run on the project's current branch (default branch / whatever it's on).
    // No worktree is created up-front — that can happen later when a task starts editing.
    let branch: string | undefined;
    try {
      branch = await invoke<string>('get_current_branch', { projectPath: target.path });
    } catch (err) {
      console.error('get_current_branch failed:', err);
    }
```

And update the terminal cwd to use `target.path` directly (it was using `target.path` already, which is correct for the pre-worktree terminal):
```typescript
      terminals: [{ localKey: `t-${Date.now()}`, cwd: target.path }],
```

- [ ] **Step 2: Update `handleAutomationRun` to leave `worktreePath` undefined**

Same change in `handleAutomationRun`: the `newSession` object includes:
```typescript
      worktreePath: target.path,
      worktreeBranch: branch || undefined,
```

Replace with:
```typescript
      worktreePath: undefined,
      worktreeBranch: undefined,
```

Remove the `get_current_branch` call from `handleAutomationRun` (lines ~1095–1101):
```typescript
    let branch: string | undefined;
    try {
      branch = await invoke<string>('get_current_branch', { projectPath: target.path });
    } catch (err) {
      console.error('get_current_branch failed:', err);
    }
```

- [ ] **Step 3: Update `activeBranch` derivation to show project branch when no worktree exists**

The line (around line 1237):
```typescript
  const activeBranch = currentSession?.worktreeBranch ?? '—';
```

Replace with:
```typescript
  // Show the worktree branch when a task is running; otherwise show the
  // project's HEAD branch. Falls back to '—' if git isn't available.
  const activeBranch = currentSession?.worktreeBranch ?? '—';
```

This remains the same text; no change needed for the derivation itself. The `—` fallback is acceptable for sessions that haven't run yet.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "fix(frontend): new sessions start with no worktree; worktree assigned at first submit"
```

---

### Task 10: End-to-end smoke test

**Files:** none (manual verification checklist)

- [ ] **Step 1: Start the development build**

```bash
npm run tauri dev
```

- [ ] **Step 2: Verify worktree creation on first submit**

1. Add a project whose git repo is clean (no uncommitted changes).
2. Type a prompt and submit.
3. In a terminal, run `git worktree list` inside the project root.
   Expected: a `wb/<id>` worktree appears in `.worktrees/`.
4. In the TitleBar, the branch pill should show `wb/<id>` (not `main` / `—`).
5. The Commit and Reject buttons should be enabled (not greyed out).

- [ ] **Step 3: Verify worktree removal on task completion**

1. Wait for the agent to finish (Done event).
2. Run `git worktree list` inside the project root again.
   Expected: the `wb/<id>` entry is gone. The `.worktrees/` directory may remain (empty) or be removed.

- [ ] **Step 4: Verify Commit flow**

1. Run a task that edits a file. When Done:
2. Click Commit → fill message → confirm.
   Expected: `git log` inside the project root shows the new commit on `wb/<id>` branch.
3. The MergePromptModal appears offering to merge into the project's HEAD branch.
4. Click Merge.
   Expected: `git log` on the project's HEAD branch shows the commit.

- [ ] **Step 5: Verify Reject (Discard) flow**

1. Run a task that edits a file. When Done:
2. Click Reject → confirm.
   Expected: `git status` in the project root shows no changes.

- [ ] **Step 6: Verify prune on startup**

1. Manually create a stale `.worktrees/wb-xxxxxx` directory inside a project (but don't register it as a worktree via git).
2. Quit and relaunch the app.
   Expected: `git worktree prune` is called; no orphan worktree entries remain in `git worktree list`.

- [ ] **Step 7: Run CI checks**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npm run build
```

Expected: all three exit 0.

---

## Notes for implementer

**Why `worktreePath` instead of `projectPath` in `git_commit` / `git_discard`?**
The worktree is a separate directory checked out to the same repo. Running `git -C <worktreePath> commit` commits only changes staged inside that directory. Running against `projectPath` would commit changes in the main working tree, which may be clean — leading to an "nothing to commit" error even when the worktree has changes.

**Why `--no-ff` in `merge_worktree_branch`?**
`--no-ff` forces a merge commit so the history clearly records that the worktree branch was integrated. Fast-forward would silently rewrite HEAD to point at the worktree tip, obscuring the boundary between what Claude did and the human's direct commits.

**Why is `worktreePath` undefined in new sessions rather than set to `projectPath`?**
Before this phase, `worktreePath` was used as the cwd for everything including the terminal and `start_task`. After Phase 1 it has a stricter meaning: the isolated worktree directory. Setting it to `projectPath` would mislead `doCommit` and `doReject` into running git operations against the project root (where there are no changes) instead of the worktree (where Claude made changes).

**Why are worktrees stored under `<projectPath>/.worktrees/`?**
The `create_worktree` command already uses this convention. Keeping worktrees inside the project directory means they are excluded from the project's own git history (they should be in `.gitignore`) and they survive across machine reboots without requiring a global config file to track their locations.

**What if `git worktree add` fails (e.g. the repo is bare or git < 2.5)?**
The frontend surfaces the raw error string from the Rust command as an assistant message and aborts without launching Claude. The user sees the exact git error. There is no fallback to running Claude in the project root — isolation is mandatory in Phase 1.

**Session resume across app restarts:**
`worktreePath` and `worktreeBranch` are persisted in `sessions.json`. If the app is restarted mid-session, the session loads with its worktree fields intact. On the next submit, `resumeId` is set so the code takes the `else` branch in `handleSubmit` and reuses the existing worktree path. If the worktree directory was deleted (e.g. by `git worktree prune` on startup), Claude will fail to launch and the user will see a clear error from the shell. A future phase can handle graceful re-creation of the worktree on resume.
