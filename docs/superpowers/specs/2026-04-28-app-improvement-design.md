# Claude Workbench Improvement Design

**Date:** 2026-04-28  
**Source plan:** `docs/app-improvement-plan.md`  
**Goal:** Move from working prototype to safe beta — worktree isolation, real permission gating, path/CSP hardening, and truthful UI.

---

## Parallelization Strategy

Phases are grouped into tracks that can run concurrently after Track A's Phase 0 lands CI.

```
Phase 0 (CI/baseline) ──────────────────────────────────────────────┐
                                                                     ▼
Track A: Phase 1 (worktrees) → Phase 2 (permissions) → Phase 4 (tests) → Phase 6 (refactor) → Phase 7 (polish)
Track B: Phase 3 (security hardening)  ─────────────────────────────┘
Track C: Phase 5 (UI truthfulness)  ────────────────────────────────┘
```

Phases 4, 6, 7 wait for all of Tracks A–C to merge.

---

## Phase 0: CI / Baseline

**What:** GitHub Actions workflow that runs `npm run build`, `cargo check`, and `cargo test` on every PR.

**Details:**
- Single workflow file: `.github/workflows/ci.yml`
- Jobs: `frontend-build` (Node 20, `npm ci && npm run build`), `rust-check` (`cargo check --all-features`), `rust-test` (`cargo test`)
- No placeholder green checks — only add test job when real tests exist (initially `cargo test` covers the Rust side; frontend test job added in Phase 4)
- Add `typecheck` step (`tsc --noEmit`) to `frontend-build` job
- Document release gates in `README.md`: worktree isolation, permission gating, path security, CSP, test coverage

---

## Phase 1: Worktree Isolation

**What:** Every real agent run gets its own git worktree before Claude starts. Commit/Reject are scoped to that worktree only.

**Details:**

**Auto-creation on task start:**
- `handleSubmit` in `App.tsx` calls `create_worktree(projectPath)` before `start_task`
- Worktree path and branch stored in `SessionState.worktreePath` / `worktreeBranch` (fields already exist)
- `start_task` receives `worktree_path` as an additional arg; Claude runs with `cwd` set to the worktree
- Worktree creation failure surfaces as a UI error before Claude starts — no silent fallback to project root

**Lifecycle management:**
- On session end (Done/Error/Stopped event) or explicit session close: `remove_worktree(projectPath, worktreePath)` called automatically
- On app startup: `git worktree prune` called once per project to clean up abandoned worktrees from crashes
- Add `list_worktrees(projectPath)` Rust command returning `Vec<{path, branch, locked}>` for debugging

**Commit/Reject scoping:**
- `git_commit` receives `worktree_path`; runs `git -C <worktreePath> add -A && git -C <worktreePath> commit -m`
- `git_discard` receives `worktree_path`; runs `git -C <worktreePath> checkout -- . && git -C <worktreePath> clean -fd .`
- Frontend blocks Commit/Reject buttons when `session.worktreePath` is null

**Merge flow (Commit):**
- After committing inside worktree, offer to merge the worktree branch into the project's current branch
- This is a UI prompt, not automatic

---

## Phase 2: Real Permission Model

**What:** Remove `--dangerously-skip-permissions` from the default agent path. Implement `resolve_permission` and `save_policy` in Rust. Agent actually pauses awaiting user decision.

**Details:**

**Removing the flag:**
- `run_agent` in `lib.rs` drops `--dangerously-skip-permissions` from the default command
- Add a `yolo_mode: bool` field to `StartTaskArgs`; only re-adds the flag when explicitly requested
- `summarize_session` also removes `--dangerously-skip-permissions`

**Pause mechanism:**
- Claude Code emits permission-request events in its stream-json output when it needs to use a tool
- The Rust stream reader detects these events and inserts a `tokio::sync::oneshot::channel` per permission request ID into a shared `HashMap<String, oneshot::Sender<bool>>`
- The stream reader awaits the oneshot before continuing to read/emit further events — this blocks the agent's stdout processing (Claude itself blocks waiting for its stdin/stdout protocol to continue)
- `resolve_permission(id: String, allow: bool, always: bool)` Rust command: looks up the sender by ID, sends the decision, removes from map
- If `allow == false`, injects a tool-error event back into the stream so Claude receives a denial message

**Policy engine:**
- `save_policy(project_path: String, tool: String, pattern: String, allow: bool)` Rust command
- Persists to `.workbench/policy.toml` in the project dir (or `~/.workbench/policies/<project-id>.toml` for global)
- Format: `[[rules]] tool = "write_file" pattern = "src/**" allow = true`
- On agent start, load applicable policies and pass as `--allowedTools` / `--disallowedTools` flags to Claude Code
- Conservative defaults: reads allowed, writes ask, destructive shell/git/network ask or deny

**YOLO mode:**
- Settings UI adds a "YOLO mode" toggle (dangerous, clearly labeled)
- Stored in `profile.json`, passed as `yolo_mode` to `start_task`

---

## Phase 3: Security Hardening

**What:** Strict CSP, tighter Tauri permissions, path-constrained file ops, API key in OS keychain.

**Details:**

**CSP:**
- Replace `"csp": null` in `tauri.conf.json` with a strict policy
- Must allow: xterm.js WebGL (blob: URLs for worker), inline styles from Tailwind (unsafe-inline for style-src only), no remote script sources
- Example starting point: `"default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost"`

**Tauri permissions:**
- Replace `"fs:default"` with scoped `fs:allow-read` / `fs:allow-write` targeting `$APPDATA` and project dirs only
- Replace `"shell:default"` + `"shell:allow-execute"` with specific shell allowlists for the commands the app actually runs (git, claude, open/xdg-open)
- Remove overly broad `opener:default` if unused

**File op path constraints:**
- `read_file`, `write_file`, `list_dir`, `list_project_files`: constrain to active session's `worktreePath` or `projectPath`, plus `~/.workbench`
- Current `write_file` sandbox is `$HOME` — tighten to project + `~/.workbench`
- `save_attachment` already scoped to `~/.workbench/attachments/` — keep as-is

**API key storage:**
- Move API key out of `profile.json` into OS keychain via Tauri's `stronghold` or `keyring` plugin
- Update Account settings UI to reflect actual storage location
- If keychain plugin not yet integrated: remove the key from `profile.json` on load and emit a warning in UI rather than storing plaintext silently

**Shell injection audit:**
- `plugin install/uninstall` shell out to `claude plugin install <name>` — validate plugin name against `[a-zA-Z0-9_-]+` before interpolating
- All other shell args already use env vars (safe) — no changes needed

---

## Phase 4: Testing

**What:** Rust unit tests for safety-critical logic. Frontend tests for permission UI and session state. CI integration.

**Details:**

**Rust tests (in `src-tauri/src/lib.rs` or `tests/` module):**
- `shell_escape` / arg safety: verify env var approach doesn't allow injection
- Git status porcelain parsing: fixture inputs → expected `GitStatusEntry` structs
- Policy decisions: given a policy TOML, verify allow/deny outcomes
- Path containment: `is_within(project_path, file_path)` edge cases (symlinks, `..` traversal)
- Worktree lifecycle: create → list → prune cycle (integration, uses temp git repo)
- Session serialization round-trip: serialize → deserialize → assert field equality

**Frontend tests (Vitest + Testing Library):**
- Session persistence restore: mock Tauri invoke, assert UI restores from `sessions.json`
- Permission UI state: given `pendingPermissions`, assert modal renders; resolve → assert cleared
- Settings appearance: change theme/density/accent → assert CSS var updates without save
- Commit/Reject disabled states: no `worktreePath` → buttons disabled

**Browser smoke tests (Playwright):**
- Onboarding flow: pick directory → assert main app shell loads
- Main shell: new chat → type prompt → assert input bar works

**Fixture-based stream tests:**
- Recorded Claude stream-json fixtures (token, tool, permission, done events)
- Assert frontend renders expected UI state from each fixture without live Claude

**CI:**
- Add frontend test job to `.github/workflows/ci.yml` in this phase
- Gate all tests on PRs

---

## Phase 5: UI Truthfulness

**What:** Fix the gap between what the UI shows and what the app actually does.

**Details:**

- **Appearance settings:** Theme, density, accent changes apply CSS vars immediately on change (not only on save). `save_appearance` is called on save as persistence — loading on startup applies the saved values at startup
- **Appearance persistence:** Keep `appearance.json` separate from `profile.json` (intentional separation already exists); ensure `load_appearance` is called on startup and applied before first render to avoid flash
- **Account copy:** Change "Stored in OS keychain" text to reflect actual storage. If keychain not yet integrated, say "Stored in app settings" or show a warning
- **Search:** Keep Search tab visibly disabled (greyed out, tooltip "Coming soon") until real search is implemented. Remove any active-looking affordances
- **Console → visible errors:** Audit all `console.error` calls in `App.tsx` and components; replace with toast/banner for user-visible errors. Specifically: worktree creation failure, commit failure, Claude launch failure, missing CLI auth, terminal startup failure
- **`summarize_session` failure:** If auto-title generation fails, keep the default session title rather than showing nothing or logging silently

---

## Phase 6: Untangle App State

**What:** Split `App.tsx` (1,473 lines) into focused hooks and service modules. No behavior changes.

**Details:**

**Hooks to extract:**
- `useProfile`: load/save profile, debounced persistence, project list management
- `useSessions`: session CRUD, serialization, active session tracking, session persistence
- `useAgentEvents`: Tauri `listen('agent-event')` setup, token batching via RAF, event routing to session state
- `useProjects`: project list from profile, project-level git state
- `useAutomations`: load/save automations, seed defaults
- `usePermissions`: `pendingPermissions` state, `handlePermAllow/Deny/AlwaysAllow`, modal vs banner routing
- `useTerminalTabs`: per-session terminal tab state, keyboard shortcut wiring

**Service modules:**
- `src/services/tauri.ts`: typed wrappers around all `invoke()` calls — single source of truth for command names and arg shapes
- `src/services/storage.ts`: debounced save utilities (reusable across hooks)

**Schema validation:**
- Add `zod` or manual validators for `sessions.json` and `profile.json` deserialization
- Add version migration stubs: `migrateSessionsV1toV2(raw)` pattern so future schema changes don't silently corrupt state

**Constraint:** Use Phase 4 tests to protect the refactor — no behavior changes, only structural.

---

## Phase 7: Product Polish

**What:** Bundle optimization, recovery flows, dirty-worktree indicators, documentation.

**Details:**

- **Code splitting:** Use `React.lazy` + `Suspense` for Settings, SearchPage, AllChatsPage to reduce initial JS chunk
- **Recovery flows:** For each failure mode (worktree creation, commit, Claude launch, missing CLI auth, terminal startup): show inline error with a retry or help action, not just a toast
- **Dirty-worktree indicator:** Show per-session badge on rail when session's worktree has uncommitted changes (poll `git_status_porcelain` on worktreePath every 30s while session is active)
- **Documentation:** Add `docs/architecture.md` covering local data locations, worktree lifecycle, cleanup steps, YOLO mode, and safety mode defaults

---

## Gaps Addressed vs. Original Plan

| Gap | Resolution |
|-----|-----------|
| Agent pause mechanism unspecified | `tokio::sync::oneshot` per permission in stream reader |
| `summarize_session` also uses `--dangerously-skip-permissions` | Removed in Phase 2 |
| Worktree pruning / crash recovery | `git worktree prune` on startup (Phase 1) |
| `write_file` sandbox too broad (`$HOME`) | Tightened to project + `~/.workbench` (Phase 3) |
| Plugin name injection risk | Regex validation before shell interpolation (Phase 3) |
| Worktree lifecycle tests missing | Added to Phase 4 |
| Session serialization round-trip tests missing | Added to Phase 4 |
| Concurrent sessions on same project | Handled by per-session worktree (Phase 1) |
| Appearance flash on startup | `load_appearance` before first render (Phase 5) |
