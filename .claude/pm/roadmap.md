# Claude Window -- Phased Roadmap

## V1 Definition: "The Parallel Viewer"

**V1 value proposition:** A developer can launch the app, start multiple Claude Code sessions against different directories, switch between them, and see the code files that Claude is editing -- all in a single window.

**V1 rule check:** The user can go from "I have work to do across multiple codebases" to "I'm watching and interacting with multiple Claude Code agents and reviewing their code changes" without leaving the app. Core loop complete.

### What V1 includes (5 features)

| # | Feature | Justification |
|---|---------|---------------|
| 1 | Session Sidebar | Cannot manage multiple sessions without a list of them |
| 2 | Agent Conversation Panel | The primary interaction surface -- reading/sending messages to Claude Code |
| 3 | Code Viewer Panel (read-only Monaco, file tree, diff view) | The differentiating value over raw terminal -- seeing code changes visually |
| 4 | Process Management (spawn, stop, restart CLI processes) | The engine that makes everything work |
| 5 | Basic Persistence (session list, last-used directory per session) | Without this, closing the app loses all context -- unacceptable |

### What V1 excludes, and what users do instead

| Excluded Feature | User alternative in V1 |
|---|---|
| Workspace Management (grouping sessions by project) | Users organize sessions by naming them descriptively; the flat session list is filterable. |
| Integrated Terminal (xterm.js) | Users keep a regular terminal open alongside the app for ad-hoc commands. |
| Diff Review Workflow (accept/reject hunks) | Users view diffs read-only in the code viewer and use git commands in their external terminal to revert unwanted changes. |
| Session Templates | Users manually set the working directory and flags when creating a new session. |
| Notification System | Users see status indicators (running/idle/error) in the sidebar; they glance at the app rather than receiving push notifications. |
| Token/Usage Dashboard | Users check token usage via Claude Code's built-in `/usage` command in the conversation. |
| Code Editing in Viewer | Users open their existing editor (VS Code, etc.) for manual edits. |
| Git Integration | Users manage git from their terminal or existing git client. |
| Multi-Agent Coordination | Users manually manage separate sessions; each session is independent. |
| Plugin/Extension System | Not available; core features cover primary workflows. |
| AI-Powered Session Summaries | Users read the conversation history directly. |
| Remote Session Support | Users run the app locally only. |

---

## Phase Breakdown

---

### Phase 1: "The Shell" -- Tauri Scaffold + Single Session

**Goal:** After Phase 1, a user can launch the app, start one Claude Code session against a chosen directory, see the conversation output rendered with syntax highlighting, and send messages.

**User Stories:**
1. As a developer, I can launch the app and see a main window with a sidebar and conversation area so I know the app is working.
2. As a developer, I can click "New Session" and pick a working directory so that a Claude Code process starts.
3. As a developer, I can see Claude Code's output rendered in the conversation panel with ANSI color support so it looks like the real CLI.
4. As a developer, I can type a message and send it to the running Claude Code session so I can interact with the agent.
5. As a developer, I can see whether the session is running, idle, or errored so I know the process state.
6. As a developer, I can stop a running session so I can free resources.

**Acceptance Criteria:**
- App launches in under 3 seconds on macOS (Apple Silicon).
- Clicking "New Session" opens a directory picker, then spawns `claude` CLI in that directory via PTY.
- Conversation panel streams output in real time with ANSI color rendering.
- Input field sends text to the PTY stdin on Enter.
- Sidebar shows one session with status indicator (green=running, gray=idle, red=error).
- Stopping a session sends SIGTERM and updates status.

**Technical Requirements:**
- Tauri 2 project scaffolded with React + TypeScript + Vite frontend.
- Rust backend: PTY spawning via `portable-pty` crate, wrapped in a Tauri command/event system.
- Frontend: React 18, Zustand store for session state, Tailwind CSS for styling.
- ANSI-to-HTML rendering (use `ansi-to-html` or `anser` npm package for the conversation panel).
- Tauri IPC: events for streaming PTY output to frontend, commands for spawn/stop/send-input.
- Layout: `react-resizable-panels` with sidebar (fixed ~250px) and main area.

**Architecture Notes:**
- PTY management lives entirely in the Rust backend. The frontend never touches processes directly.
- Each session gets a unique ID (UUID). All IPC messages reference session IDs.
- Define the `Session` data model now: `{ id, name, workingDir, status, createdAt, pid }`.
- Use Tauri's event system (not polling) for streaming PTY output. Pattern: Rust spawns a reader thread per PTY, emits `session:output:{id}` events.
- The Zustand store shape should be designed for multiple sessions from day one, even though Phase 1 only exercises one.

**Out of Scope:** Multiple sessions, code viewer, persistence, file watching, Monaco editor, keyboard shortcuts.

**Dependencies:** None (greenfield).

---

### Phase 2: "The Multiplexer" -- Multiple Sessions + Sidebar

**Goal:** After Phase 2, a user can run 4+ Claude Code sessions simultaneously, switch between them instantly, and rename/filter sessions.

**User Stories:**
1. As a developer, I can create additional sessions while existing ones are running so I can work in parallel.
2. As a developer, I can click a session in the sidebar to switch the conversation panel to that session so I can check on different agents.
3. As a developer, I can rename a session so I can tell them apart (e.g., "backend-auth" vs "frontend-dashboard").
4. As a developer, I can filter/search sessions in the sidebar so I can find the right one quickly.
5. As a developer, I can restart a crashed or stopped session so I can recover without losing my place.
6. As a developer, I can see unread activity indicators on sessions I'm not currently viewing so I know which agents need attention.

**Acceptance Criteria:**
- 4 concurrent sessions run without UI jank or noticeable performance degradation.
- Session switching completes in under 200ms (conversation panel swaps instantly; output history is buffered in memory).
- Sidebar shows all sessions sorted by most-recently-active.
- Each session maintains its own scrollback buffer (at least 10,000 lines).
- Restarting a session spawns a new `claude` CLI process in the same working directory.
- Unread dot appears on sidebar items that received output while not focused.

**Technical Requirements:**
- Rust backend: session registry (HashMap of session ID to PTY handle + metadata). Concurrent access via `tokio::sync::RwLock` or similar.
- Frontend: Zustand store holds a map of `sessionId -> { messages[], scrollPosition, unreadCount }`. Active session ID tracked separately.
- Conversation history kept in memory per session. Implement a ring buffer or capped vector (e.g., 10K messages) to bound memory.
- Sidebar component: list with click handler, inline rename (double-click), filter input at top.
- Pass Claude Code config flags (e.g., `--model`, `--allowedTools`) at session creation time via a simple "advanced options" text field.

**Architecture Notes:**
- The output buffering strategy chosen here is permanent. Use an append-only log per session in the Zustand store, with virtual scrolling in the UI (react-virtuoso or similar) to handle large histories.
- Session metadata (name, workingDir, status) is separate from session output. This separation matters for persistence in Phase 4.

**Out of Scope:** Code viewer, persistence across app restarts, file watching, keyboard shortcuts, workspaces.

**Dependencies:** Phase 1 (single session must work before multiplexing).

---

### Phase 3: "The Viewer" -- Code Panel with Monaco + File Watching

**Goal:** After Phase 3, when Claude edits a file, the user automatically sees the updated file content with syntax highlighting and can view diffs of what changed.

**User Stories:**
1. As a developer, I can see a file tree for the current session's working directory so I can browse the project.
2. As a developer, I can click a file in the tree to open it in the code viewer with syntax highlighting so I can read code without leaving the app.
3. As a developer, when Claude edits a file, the code viewer automatically navigates to that file so I can see what changed immediately.
4. As a developer, I can toggle between "current content" and "diff view" so I can see exactly what Claude changed.
5. As a developer, I can open multiple files in tabs so I can cross-reference code.
6. As a developer, I can resize the conversation panel and code panel by dragging the divider so I can allocate screen space to what matters.

**Acceptance Criteria:**
- File tree renders the working directory with expand/collapse for folders, file-type icons.
- Monaco editor loads files read-only with correct syntax highlighting (language detected from extension).
- When Claude Code's output contains a file edit (detected via pattern matching on tool-use output), the viewer auto-opens that file within 1 second.
- Diff view shows inline or side-by-side diff (Monaco's built-in diff editor).
- File watcher detects changes on disk and refreshes the open file within 1 second.
- Tabs allow up to 10 open files; least-recently-used tab closes when limit is reached.
- Three-panel layout: sidebar | conversation | code viewer, all resizable.

**Technical Requirements:**
- Rust backend: file system commands (read directory tree, read file contents) exposed as Tauri commands. File watcher using `notify` crate, emitting `file:changed:{path}` events.
- Monaco Editor integration: `@monaco-editor/react` package. Configure as read-only. Use Monaco's built-in diff editor for diff view.
- File tree component: lazy-loaded (only expand directories on click). Use Tauri command to list directory contents.
- Auto-navigation: parse Claude Code output for file edit patterns (look for tool_use blocks mentioning file paths). When detected, emit a frontend event that opens that file.
- Tab state stored per session in Zustand.

**Architecture Notes:**
- File watching scope: watch only the working directory of the active session. When switching sessions, unwatch the old directory and watch the new one. This keeps file descriptor usage bounded.
- For diff view, store a "before" snapshot when a file edit is detected. The simplest approach: when the file watcher fires, keep the previous content in memory as the diff baseline. Reset the baseline when the user dismisses the diff or after a configurable timeout.
- Monaco is heavy (~5MB). Lazy-load it so it does not affect initial app startup time. Load it only when the code panel is first opened.
- The pattern matching for "Claude edited a file" needs to be resilient to Claude Code output format changes. Start with regex matching on known patterns and make it a clearly isolated module that can be updated.

**Out of Scope:** Code editing, git integration, accept/reject hunks, inline commenting, split editor view.

**Dependencies:** Phase 2 (needs multi-session context to know which working directory to show).

---

### Phase 4: "The Persistent App" -- SQLite Persistence + Crash Recovery + Keyboard Shortcuts

**Goal:** After Phase 4, the user can close the app and reopen it to find all their sessions preserved, resume a crashed session with one click, and drive the entire app from the keyboard.

**User Stories:**
1. As a developer, I can close the app and reopen it to find my session list intact so I don't lose my work.
2. As a developer, I can see conversation history from previous sessions so I can review what Claude did yesterday.
3. As a developer, when a session crashes, I see a clear error message and a "Restart" button so I can recover immediately.
4. As a developer, I can use keyboard shortcuts (Cmd+N new session, Cmd+1-9 switch sessions, Cmd+Enter send message, Cmd+W close session) so I can work fast.
5. As a developer, I can see Claude Code's version and get a warning if my CLI version is unsupported so I avoid mysterious failures.
6. As a developer, I can configure API key / environment variables per session so I can work with different accounts.

**Acceptance Criteria:**
- Session metadata and conversation history persisted to SQLite. Survives app restart.
- Conversation history loads from SQLite on session select (paginated, most recent first).
- Crash recovery: if a session's process dies unexpectedly, status updates to "crashed" with the exit code. "Restart" button spawns a new process (with `--resume` flag if available).
- Zero data loss: output is written to SQLite in near-real-time (batched writes, flush every 1 second or on 100 messages, whichever comes first).
- All primary actions have keyboard shortcuts. Shortcut hint shown in tooltips.
- Version check: on app start, run `claude --version`, parse output, warn if below minimum supported version.
- Env var configuration: per-session key-value editor stored in SQLite.

**Technical Requirements:**
- Tauri SQLite plugin (`tauri-plugin-sql`) for persistence. Schema: `sessions` table (id, name, working_dir, status, created_at, updated_at, env_vars JSON), `messages` table (id, session_id, content, timestamp, type).
- Rust backend: batch writer that accumulates output and flushes to SQLite periodically.
- Frontend: keyboard shortcut system using a global event listener + a shortcut registry.
- Claude Code version detection: Tauri command that runs `claude --version` and parses semver.
- Env var editor: simple key-value form in a session settings modal.

**Architecture Notes:**
- SQLite schema should be versioned from day one. Include a `schema_version` table and a migration runner.
- Message storage: store raw PTY output as blobs, not parsed content. Parsing is a frontend concern.
- Keyboard shortcuts: build the registry as a data structure, not hardcoded if/else.
- API key management: store in the OS keychain via `tauri-plugin-keyring`, not in SQLite.

**Out of Scope:** Workspaces, rate limit dashboard, notifications, session templates, onboarding.

**Dependencies:** Phase 3 (persistence needs the full data model to be stable before committing to a schema).

---

### Phase 5: "The Workspace" -- Workspace Management + Notifications + Polish

**Goal:** After Phase 5, the user can organize sessions into project workspaces, receive notifications when agents need attention, and the app feels polished enough for daily use.

**User Stories:**
1. As a developer, I can create a workspace tied to a project directory and see only sessions belonging to that workspace so I can focus.
2. As a developer, I can switch between workspaces in one click so I can context-switch between client projects.
3. As a developer, I receive a desktop notification when a session finishes or errors so I can multitask.
4. As a developer, I see a badge count on workspace items showing active/errored sessions so I can triage.
5. As a developer, I get a first-run onboarding flow that checks for Claude Code installation and walks me through creating my first session.
6. As a developer, I see rate-limit warnings when Claude Code reports throttling so I can adjust my usage.
7. As a developer, the app checks for updates and prompts me to install new versions.

**Acceptance Criteria:**
- Workspaces are CRUD-able. Each workspace has a name, root directory, and color/icon.
- Sessions auto-associate with the workspace whose root directory matches their working directory.
- Desktop notifications via Tauri notification plugin. Configurable per-workspace.
- Rate limit detection: parse Claude Code output for rate limit messages, surface as a warning banner.
- Onboarding: on first launch, check for `claude` binary in PATH. Guide through creating first session.
- Auto-update: Tauri's built-in updater plugin with GitHub Releases backend.

**Technical Requirements:**
- SQLite: `workspaces` table. Foreign key from sessions to workspaces (nullable).
- Tauri notification plugin for desktop notifications.
- Tauri updater plugin for auto-update.
- Rate limit parser: regex-based extraction from PTY output.
- Onboarding: modal/wizard component on first launch.

**Out of Scope:** Integrated terminal, diff review workflow (accept/reject), session templates, token dashboard.

**Dependencies:** Phase 4 (persistence must exist before workspaces can be stored).

---

### Phase 6: "The Reviewer" -- Integrated Terminal + Diff Workflow + Token Dashboard

**Goal:** After Phase 6, the user can perform the complete code review workflow inside the app and track token usage.

**User Stories:**
1. As a developer, I can open an integrated terminal in any session's working directory so I can run commands without leaving the app.
2. As a developer, I can see a list of all files Claude changed in a session and review each diff so I can audit changes systematically.
3. As a developer, I can accept or reject individual file changes so I can control what persists.
4. As a developer, I can see token usage per session and cumulative totals so I can track costs.
5. As a developer, I can create session templates so I can quickly spin up common configurations.

**Acceptance Criteria:**
- xterm.js terminal embedded in a panel/tab, connected to a separate PTY.
- Changed files list derived from file watcher events, grouped per session.
- Accept = no-op. Reject = restore from "before" snapshot.
- Token dashboard shows per-session and total usage.
- Session templates CRUD, stored in SQLite.

**Out of Scope:** Code editing, git integration, multi-agent coordination, hunk-level accept/reject.

**Dependencies:** Phase 5 (needs stable persistence and workspace context).

---

## Architecture Decisions (must be made before Phase 1)

| Decision | Recommendation | Why |
|----------|---------------|-----|
| PTY abstraction layer | `SessionManager` trait in Rust with spawn/stop/send/subscribe | Every phase depends on process management; tangled code creates rewrites |
| Session ID as universal key | UUID on every IPC message and DB row | Multi-session is Phase 2; singleton assumptions require full rewrite |
| SQLite schema versioning | Migration system from first migration | Schema evolves across phases; without migrations, upgrades break |
| Output parser pipeline | Isolated `OutputParser` module emitting structured events | Phases 3, 5, 6 all add parsers; ad-hoc regex scatters and conflicts |
| Semantic HTML from day one | Proper `<button>`, `<nav>`, `<main>`, `<aside>` elements | Retrofitting accessibility is a near-complete rewrite |
| Zustand store shape | Multi-session from Phase 1: `{ sessions: Record<string, SessionState>, activeSessionId }` | Refactoring singleton store touches every component |
| Tauri command naming | `domain:action` pattern: `session:spawn`, `fs:read_file` | IPC contract is permanent; inconsistent naming causes confusion |

## Summary Timeline

| Phase | Name | Core Deliverable | Sprint Estimate |
|---|---|---|---|
| 1 | The Shell | Single Claude Code session in a GUI | 1 sprint |
| 2 | The Multiplexer | 4+ concurrent sessions, sidebar management | 1 sprint |
| 3 | The Viewer | Monaco code panel, file watching, diff view | 1.5 sprints |
| 4 | The Persistent App | SQLite, crash recovery, keyboard shortcuts | 1 sprint |
| 5 | The Workspace | Workspaces, notifications, onboarding, polish | 1 sprint |
| 6 | The Reviewer | Terminal, diff workflow, token dashboard, templates | 1.5 sprints |

**V1 = Phases 1 through 4.** After Phase 4, all three personas can complete their core workflow.
