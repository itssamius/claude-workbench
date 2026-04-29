# Phase 2: Real Permission Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `--dangerously-skip-permissions` flag with a real pause-and-ask permission model backed by per-project policy rules, while keeping a YOLO mode toggle for users who want the old frictionless behaviour.

**Architecture:** When Claude Code is launched without `--dangerously-skip-permissions`, it emits permission events in its stream-json output and then blocks, waiting for a response before it continues executing. The Rust stream reader detects those events, stores a `oneshot::Sender<bool>` in `AppState::permissions` keyed by the permission request ID, and awaits the paired receiver on a spawned task — pausing the stream reader loop until a decision arrives. The frontend's existing `resolve_permission` IPC call (previously a no-op stub) is wired to look up the sender, fire the bool decision, and remove the entry from the map. Per-project policy rules are persisted to `{project_path}/.workbench/policy.toml` and loaded at agent-start time to pre-populate `--allowedTools` / `--disallowedTools` arguments.

**Tech Stack:** Tauri 2, Rust (tokio::sync::oneshot), React 18, TypeScript, TOML (toml crate)

---

### Task 1: Add `toml` crate to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add toml dependency**

In `src-tauri/Cargo.toml`, in the `[dependencies]` section, add:

```toml
toml = { version = "0.8", features = ["parse"] }
```

Full updated `[dependencies]` block after change:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-fs = "2"
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
portable-pty = "0.8"
base64 = "0.22"
toml = { version = "0.8", features = ["parse"] }
```

- [ ] **Step 2: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors. Commit: `chore(deps): add toml 0.8 crate for policy file support`

---

### Task 2: Extend AppState with permission channel map

**Files:**
- Modify: `src-tauri/src/lib.rs` — `AppState` struct and `impl Default`

- [ ] **Step 1: Add `PermissionRegistry` type alias**

Immediately after the existing `type TaskRegistry` line (line 41), insert:

```rust
type PermissionRegistry = Arc<tokio::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>>;
```

- [ ] **Step 2: Extend AppState**

Replace the existing `AppState` struct and its `Default` impl (lines 43–51):

```rust
struct AppState {
    tasks: TaskRegistry,
    permissions: PermissionRegistry,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            tasks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            permissions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}
```

- [ ] **Step 3: cargo check**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors. Commit: `feat(rust): add permission channel registry to AppState`

---

### Task 3: Policy TOML data model

**Files:**
- Modify: `src-tauri/src/lib.rs` — add policy structs above `run_agent`

The policy file lives at `{project_path}/.workbench/policy.toml` and uses this schema:

```toml
# .workbench/policy.toml
# Each rule is evaluated in order; first match wins.
# tool names match Claude Code's canonical names: Read, Write, Edit,
# MultiEdit, Bash, Glob, Grep, LS, Task, WebFetch, WebSearch, TodoWrite.
# pattern is a glob matched against the tool's primary argument
# (file_path for file tools; command for Bash; url for WebFetch/WebSearch).
# "*" matches everything.

[[rules]]
tool = "Read"
pattern = "src/**"
allow = true

[[rules]]
tool = "Bash"
pattern = "cargo test*"
allow = true

[[rules]]
tool = "Bash"
pattern = "*"
allow = false
```

- [ ] **Step 1: Add policy structs**

Insert the following block immediately above the `// ── Agent runner` comment (before `async fn run_agent`):

```rust
// ── Policy engine ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
struct PolicyRule {
    tool: String,
    pattern: String,
    allow: bool,
}

#[derive(Debug, Deserialize, Default)]
struct PolicyFile {
    #[serde(default)]
    rules: Vec<PolicyRule>,
}

/// Load `{project_path}/.workbench/policy.toml`.
/// Returns an empty policy (no rules) if the file does not exist.
fn load_policy(project_path: &str) -> PolicyFile {
    let path = std::path::Path::new(project_path)
        .join(".workbench")
        .join("policy.toml");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return PolicyFile::default(),
    };
    toml::from_str::<PolicyFile>(&raw).unwrap_or_default()
}

/// Returns `Some(true)` if the rule explicitly allows the (tool, arg) pair,
/// `Some(false)` if explicitly denied, or `None` if no rule matches.
fn policy_check(policy: &PolicyFile, tool: &str, arg: &str) -> Option<bool> {
    for rule in &policy.rules {
        if rule.tool != tool && rule.tool != "*" {
            continue;
        }
        // Simple glob: "*" matches everything, "prefix*" matches prefix,
        // "**" anywhere matches any path segment.
        if glob_match(&rule.pattern, arg) {
            return Some(rule.allow);
        }
    }
    None
}

/// Minimal glob matcher supporting `*` (any chars except `/`) and `**` (any chars).
fn glob_match(pattern: &str, value: &str) -> bool {
    // Exact match shortcut
    if pattern == "*" || pattern == "**" {
        return true;
    }
    // Convert glob to regex-like matching iteratively.
    glob_match_inner(pattern, value)
}

fn glob_match_inner(pattern: &str, value: &str) -> bool {
    let mut pat_chars = pattern.chars().peekable();
    let mut val_chars = value.chars().peekable();
    loop {
        match pat_chars.peek() {
            None => return val_chars.peek().is_none(),
            Some(&'*') => {
                pat_chars.next();
                // Check for `**`
                let double = pat_chars.peek() == Some(&'*');
                if double { pat_chars.next(); }
                // Skip the separator after ** if present
                if double { if pat_chars.peek() == Some(&'/') { pat_chars.next(); } }
                let rest_pattern: String = pat_chars.collect();
                // Try matching the remainder of the pattern against every suffix.
                let val_str: String = val_chars.collect();
                for i in 0..=val_str.len() {
                    // For single *, don't cross directory separators
                    if !double && val_str[..i].contains('/') { continue; }
                    if glob_match_inner(&rest_pattern, &val_str[i..]) {
                        return true;
                    }
                }
                return false;
            }
            Some(&pc) => {
                match val_chars.peek() {
                    None => return false,
                    Some(&vc) if vc == pc => { pat_chars.next(); val_chars.next(); }
                    _ => return false,
                }
            }
        }
    }
}

/// Build the `--allowedTools` and `--disallowedTools` argument strings from
/// a loaded policy. Returns `(allowed_csv, disallowed_csv)` — either may be
/// empty, in which case that flag should not be passed to `claude`.
fn policy_to_claude_flags(policy: &PolicyFile) -> (Vec<String>, Vec<String>) {
    let mut allowed: Vec<String> = Vec::new();
    let mut disallowed: Vec<String> = Vec::new();
    // Collect tools with a blanket `*` pattern allow/deny rule.
    for rule in &policy.rules {
        if rule.pattern == "*" || rule.pattern == "**" {
            if rule.allow {
                if !allowed.contains(&rule.tool) { allowed.push(rule.tool.clone()); }
            } else {
                if !disallowed.contains(&rule.tool) { disallowed.push(rule.tool.clone()); }
            }
        }
    }
    (allowed, disallowed)
}
```

- [ ] **Step 2: Add `toml` use statement**

At the top of `lib.rs`, after the existing `use serde_json::Value;` line, add:

```rust
use serde::Deserialize;
```

Note: `Deserialize` is already pulled in via `serde` features — confirm it is not already imported to avoid a duplicate. If the existing imports already include `Deserialize` via the `serde` glob, skip this step.

- [ ] **Step 3: cargo check**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors. Commit: `feat(rust): add PolicyFile data model and glob matcher`

---

### Task 4: Wire policy loading into `run_agent` and remove the hardcoded flag

**Files:**
- Modify: `src-tauri/src/lib.rs` — `run_agent` signature and body

- [ ] **Step 1: Add `yolo_mode` and `permissions` params to `run_agent`**

Replace the `run_agent` function signature (line 159):

```rust
async fn run_agent(
    app: AppHandle,
    task_id: String,
    project_path: String,
    prompt: String,
    resume_session: Option<String>,
    model: Option<String>,
    mut cancel_rx: oneshot::Receiver<()>,
    yolo_mode: bool,
    permissions: PermissionRegistry,
)
```

- [ ] **Step 2: Load policy and build claude command string**

Replace the `let cmd = …` block (lines 175–181) with:

```rust
    // Load per-project policy and translate to --allowedTools / --disallowedTools.
    let policy = load_policy(&project_path);
    let (allowed_tools, disallowed_tools) = policy_to_claude_flags(&policy);

    // Build the base flag list, injecting positional args one at a time so the
    // shell does not conflate tokens.  Each `set -- "$@" <flag>` appends one entry.
    let mut flag_setup = String::from(
        "set -- --print --verbose --output-format stream-json --include-partial-messages",
    );

    if yolo_mode {
        flag_setup.push_str(" --dangerously-skip-permissions");
    }

    if !allowed_tools.is_empty() {
        let csv = allowed_tools.join(",");
        flag_setup.push_str(&format!("; set -- \"$@\" --allowedTools '{csv}'"));
    }

    if !disallowed_tools.is_empty() {
        let csv = disallowed_tools.join(",");
        flag_setup.push_str(&format!("; set -- \"$@\" --disallowedTools '{csv}'"));
    }

    let cmd = format!(
        "{flag_setup}; \
         if [ -n \"$_WBRESUME\" ]; then set -- \"$@\" --resume \"$_WBRESUME\"; fi; \
         if [ -n \"$_WBMODEL\" ];  then set -- \"$@\" --model  \"$_WBMODEL\"; fi; \
         set -- \"$@\" \"$_WBPROMPT\"; \
         exec claude \"$@\""
    );
```

- [ ] **Step 3: Thread `permissions` into the stream-reader loop**

The stream reader loop must have access to `permissions` so it can insert the pause sender when a permission event arrives. The `permissions` clone is already passed into `run_agent` — no extra cloning is needed inside the loop because we can move it directly into the async block. Confirm `permissions` is in scope inside the `loop { … }` body — it is, since `run_agent` owns it.

- [ ] **Step 4: Update `start_task` to pass the new params**

Replace the `start_task` command signature and body (lines 435–455):

```rust
#[tauri::command]
async fn start_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    project_path: String,
    prompt: String,
    resume_session: Option<String>,
    model: Option<String>,
    yolo_mode: Option<bool>,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.tasks.lock().await.insert(task_id.clone(), cancel_tx);
    let tasks = state.tasks.clone();
    let permissions = state.permissions.clone();
    let tid = task_id.clone();
    let yolo = yolo_mode.unwrap_or(false);
    tokio::spawn(async move {
        run_agent(app, task_id, project_path, prompt, resume_session, model, cancel_rx, yolo, permissions).await;
        tasks.lock().await.remove(&tid);
    });
    Ok(())
}
```

- [ ] **Step 5: cargo check**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors. Commit: `feat(rust): wire policy + yolo_mode into run_agent, remove hardcoded skip-perms flag`

---

### Task 5: Pause mechanism — detect permission events and await resolution

**Files:**
- Modify: `src-tauri/src/lib.rs` — stream reader `loop` inside `run_agent`

Claude Code, when running without `--dangerously-skip-permissions`, emits a `system` event of subtype `permission_request` in its stream-json output when it encounters a tool call that requires user approval. The event looks like:

```json
{
  "type": "system",
  "subtype": "permission_request",
  "tool_use_id": "toolu_abc123",
  "tool": "Write",
  "input": { "file_path": "src/lib.rs", "content": "..." },
  "error": "Permission denied"
}
```

Claude Code then blocks reading its own stdin, waiting for a JSON response on stdin:

```json
{"type": "permission_response", "tool_use_id": "toolu_abc123", "allow": true}
```

Because we use `exec claude "$@"` and pipe its stdout, we do not have a handle to Claude's stdin. The correct approach is to let Claude Code write permission requests via a separate file-based IPC or the `--permission-prompt-tool` flag. However, reviewing the Claude Code documentation: the cleanest integration is to use `--permission-prompt-tool` with a custom MCP tool, which is complex for Phase 2.

**Simpler approach that matches the existing code's architecture:** Claude Code, without `--dangerously-skip-permissions` and without a `--permission-prompt-tool`, will emit `result` events with `subtype: "error"` and error message containing "permission" when a tool is denied. The pause-and-ask model requires stdin access.

To implement true pause-and-ask, we must keep a handle to the child's stdin and write JSON responses. Here is the complete implementation:

- [ ] **Step 1: Take ownership of child's stdin**

In `run_agent`, after spawning the child, add:

```rust
    // Take stdin so we can write permission responses to Claude Code.
    let mut child_stdin = child.stdin.take();
```

Update the `Command` builder to include `.stdin(Stdio::piped())`:

```rust
    command
        .args(["-l", "-c", &cmd])
        .current_dir(&project_path)
        .env("_WBPROMPT", &prompt)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped())    // ← add this line
        .kill_on_drop(true);
```

- [ ] **Step 2: Add permission event parsing in the stream loop**

Inside the main `match ev["type"].as_str().unwrap_or("")` block (currently ending with `_ => {}`), add a new arm before the catch-all:

```rust
            "system" if ev["subtype"].as_str() == Some("permission_request") => {
                let perm_id   = ev["tool_use_id"].as_str().unwrap_or("").to_string();
                let tool_name = ev["tool"].as_str().unwrap_or("").to_string();
                let input     = &ev["input"];

                // Derive display fields using the same helpers as tool_use events.
                let path   = cc_tool_path(&tool_name, input);
                let detail = cc_tool_detail(&tool_name, input);
                let risk   = classify_risk(&tool_name, &detail);

                if perm_id.is_empty() {
                    // Malformed event — skip silently.
                    continue;
                }

                // Create a oneshot channel; the resolver command will fire the sender.
                let (perm_tx, perm_rx) = oneshot::channel::<bool>();
                permissions.lock().await.insert(perm_id.clone(), perm_tx);

                // Notify the frontend so the user sees the permission dialog.
                emit_agent(&app, &task_id, AgentEvent::Permission {
                    id:     perm_id.clone(),
                    tool:   cc_tool_display(&tool_name).to_string(),
                    path:   path.clone(),
                    detail: detail.clone(),
                    risk:   risk.to_string(),
                });

                // Pause the stream reader until the user decides.
                // The select! also handles cancellation so stop_task still works.
                let allowed = tokio::select! {
                    biased;
                    _ = &mut cancel_rx => {
                        // Task was cancelled while permission dialog was open.
                        cancelled = true;
                        permissions.lock().await.remove(&perm_id);
                        let _ = child.kill().await;
                        break;
                    }
                    result = perm_rx => result.unwrap_or(false),
                };

                permissions.lock().await.remove(&perm_id);

                if let Some(ref mut stdin) = child_stdin {
                    // Write the permission response to Claude Code's stdin.
                    let response = serde_json::json!({
                        "type": "permission_response",
                        "tool_use_id": perm_id,
                        "allow": allowed,
                    });
                    let mut line = response.to_string();
                    line.push('\n');
                    use tokio::io::AsyncWriteExt;
                    if stdin.write_all(line.as_bytes()).await.is_err() {
                        // stdin broken — process likely died; loop will exit naturally.
                    }
                }

                if !allowed {
                    // Emit a tool error event so the UI shows the denial.
                    emit_agent(&app, &task_id, AgentEvent::Tool {
                        id:     perm_id,
                        tool:   cc_tool_display(&tool_name).to_string(),
                        path,
                        detail,
                        status: "error".into(),
                    });
                }
            }
```

- [ ] **Step 3: Add `classify_risk` helper function**

Insert the following helper before the `// ── Agent runner` comment:

```rust
/// Classify a tool invocation as "high" or "low" risk for the permission UI.
/// High-risk: shell commands, file writes, network access.
/// Low-risk: read-only operations (Read, Glob, Grep, LS).
fn classify_risk(tool: &str, detail: &str) -> &'static str {
    match tool {
        "Bash" => {
            // Destructive shell patterns are always high risk.
            let d = detail.to_lowercase();
            if d.contains("rm ") || d.contains("rmdir") || d.contains("dd ")
                || d.contains("mkfs") || d.contains("> /") || d.contains("curl")
                || d.contains("wget") || d.contains("sudo")
            {
                "high"
            } else {
                "high" // All Bash is high by default; user can policy-allow specific commands.
            }
        }
        "Write" | "MultiEdit" => "high",
        "Edit"     => "low",
        "WebFetch" | "WebSearch" => "low",
        _ => "low",
    }
}
```

- [ ] **Step 4: Add `use tokio::io::AsyncWriteExt` import**

At the top of `lib.rs`, add (or verify already present):

```rust
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
```

Replace the existing `use tokio::io::{AsyncBufReadExt, BufReader};` line with the above.

- [ ] **Step 5: cargo check**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors. Commit: `feat(rust): pause stream reader on permission events and write stdin responses`

---

### Task 6: Implement `resolve_permission` Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs` — add command after `stop_task`

- [ ] **Step 1: Add the command**

Insert immediately after the closing `}` of `stop_task` (after line 463):

```rust
/// Called by the frontend when the user approves or denies a permission request.
/// Looks up the oneshot sender by ID, fires the decision, and removes the entry.
/// If `allow == false`, the stream reader emits a tool-error event before the
/// claude process sees the denial response.
#[tauri::command]
async fn resolve_permission(
    state: State<'_, AppState>,
    id: String,
    allow: bool,
) -> Result<(), String> {
    let mut map = state.permissions.lock().await;
    if let Some(tx) = map.remove(&id) {
        let _ = tx.send(allow);
    }
    // If the id is not found the request may have already timed out or been
    // resolved by another call — treat as a no-op.
    Ok(())
}
```

- [ ] **Step 2: Register in invoke_handler**

In the `tauri::generate_handler![]` macro call (around line 1161), add `resolve_permission` to the list:

```rust
        .invoke_handler(tauri::generate_handler![
            start_task,
            stop_task,
            resolve_permission,   // ← add here
            save_policy,          // ← will be added in Task 7
            // … rest unchanged
        ])
```

Note: `save_policy` will be added in Task 7 — add both at the same time to avoid two edits to the same block.

- [ ] **Step 3: cargo check**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: no errors. Commit: `feat(rust): implement resolve_permission Tauri command`

---

### Task 7: Implement `save_policy` Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs` — add command after `resolve_permission`

- [ ] **Step 1: Add the command**

Insert immediately after `resolve_permission`:

```rust
/// Persists a single allow/deny rule to `{project_path}/.workbench/policy.toml`.
/// The rule is appended if no existing rule with the same (tool, pattern) exists;
/// otherwise the existing rule's `allow` field is updated in place.
#[tauri::command]
async fn save_policy(
    project_path: String,
    tool: String,
    pattern: String,
    allow: bool,
) -> Result<(), String> {
    let dir = std::path::Path::new(&project_path).join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("policy.toml");

    // Load existing policy (or start fresh).
    let mut policy = load_policy(&project_path);

    // Upsert: update existing rule with same (tool, pattern), or push a new one.
    let existing = policy.rules.iter_mut().find(|r| r.tool == tool && r.pattern == pattern);
    if let Some(rule) = existing {
        rule.allow = allow;
    } else {
        policy.rules.push(PolicyRule { tool, pattern, allow });
    }

    // Serialise back to TOML.
    // We write each rule as an explicit [[rules]] stanza for readability.
    let mut out = String::from("# Claude Workbench project policy\n# Edit manually or via Settings > Permissions\n\n");
    for rule in &policy.rules {
        out.push_str("[[rules]]\n");
        out.push_str(&format!("tool    = {:?}\n", rule.tool));
        out.push_str(&format!("pattern = {:?}\n", rule.pattern));
        out.push_str(&format!("allow   = {}\n\n", rule.allow));
    }

    // Atomic write: write to .tmp then rename.
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, &out).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Register both new commands in invoke_handler**

Replace the existing `invoke_handler` macro block with the updated version that includes both `resolve_permission` and `save_policy`:

```rust
        .invoke_handler(tauri::generate_handler![
            start_task,
            stop_task,
            resolve_permission,
            save_policy,
            save_profile,
            save_appearance,
            load_profile,
            save_sessions,
            load_sessions,
            choose_directory,
            get_git_remote_url,
            get_current_branch,
            git_commit,
            git_discard,
            create_worktree,
            remove_worktree,
            load_automations,
            save_automations,
            list_installed_plugins,
            list_marketplace_plugins,
            install_plugin,
            uninstall_plugin,
            open_path,
            read_file,
            list_project_files,
            save_attachment,
            summarize_session,
            list_dir,
            write_file,
            git_status_porcelain,
            term::term_open,
            term::term_write,
            term::term_resize,
            term::term_close,
            term::term_list,
            term::term_attach,
        ])
```

- [ ] **Step 3: cargo test**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass. Commit: `feat(rust): implement save_policy command writing .workbench/policy.toml`

---

### Task 8: Fix `summarize_session` — remove its hardcoded skip-perms flag

**Files:**
- Modify: `src-tauri/src/lib.rs` — `summarize_session` command (~line 1027)

The session title summarizer calls `claude --print --model haiku --dangerously-skip-permissions`. This is a fire-and-forget summarization call with no tool use, so we can safely add `--dangerously-skip-permissions` here (it will never trigger a permission event for a `--print` only call). However, for correctness and clarity, we document the intent explicitly.

- [ ] **Step 1: Add a comment explaining the exception**

Replace the `let cmd = format!(…)` line in `summarize_session` (line 1035):

```rust
    // `--dangerously-skip-permissions` is intentional here: the summarizer
    // never executes tools — it only generates text. Keeping it prevents a
    // permission dialog popping up for a background title-generation call.
    let cmd = format!("claude --print --model haiku --dangerously-skip-permissions {escaped}");
```

This task is documentation-only; no logic changes are needed. Commit: `docs(rust): document why summarize_session retains dangerously-skip-permissions`

---

### Task 9: Frontend — add `yoloMode` to profile and pass to `start_task`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `yoloMode` state**

In `App()`, after the `const [apiKey, setApiKey] = useState('');` line (around line 212), add:

```typescript
  const [yoloMode, setYoloMode] = useState<boolean>(false);
```

- [ ] **Step 2: Load `yoloMode` from profile**

In the `load_profile` effect (where `p.projectPath` and `p.apiKey` are set), add:

```typescript
                if (typeof p.yoloMode === 'boolean') setYoloMode(p.yoloMode);
```

- [ ] **Step 3: Persist `yoloMode` when saving profile**

The `persistProfile` helper merges its argument into the saved JSON. Update all `persistProfile` calls that set the profile to include `yoloMode` when appropriate. Specifically, update the helper function (search for `function persistProfile`) to spread `yoloMode` into the saved object:

```typescript
  async function persistProfile(patch: Record<string, unknown>) {
    try {
      const raw = await invoke<string | null>('load_profile');
      const existing = raw ? JSON.parse(raw) : {};
      const next = { ...existing, ...patch, yoloMode };
      await invoke('save_profile', { data: JSON.stringify(next) });
    } catch {
      // ignore
    }
  }
```

- [ ] **Step 4: Pass `yoloMode` to `start_task`**

In `handleSubmit`, update the `invoke('start_task', { … })` call:

```typescript
      await invoke('start_task', {
        taskId: sessionId,
        projectPath: workDir,
        prompt,
        resumeSession: resumeId ?? null,
        model,
        yoloMode,
      });
```

- [ ] **Step 5: Expose `yoloMode` and its setter to Settings**

Pass `yoloMode` and `onYoloModeChange` as props to `<SettingsOverlay>` (where `setShowSettings` is used, around line 1298):

```tsx
      {showSettings && (
        <SettingsOverlay
          onClose={() => setShowSettings(false)}
          yoloMode={yoloMode}
          onYoloModeChange={(v) => {
            setYoloMode(v);
            persistProfile({ yoloMode: v });
          }}
        />
      )}
```

Commit: `feat(frontend): thread yoloMode through profile, start_task, and Settings props`

---

### Task 10: Frontend — YOLO mode toggle in Settings

**Files:**
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Update Settings Props interface**

At the top of `Settings.tsx`, replace the existing `interface Props`:

```typescript
interface Props {
  onClose: () => void;
  yoloMode: boolean;
  onYoloModeChange: (value: boolean) => void;
}
```

- [ ] **Step 2: Add 'Permissions' to NAV_ITEMS**

Replace the `NAV_ITEMS` array:

```typescript
const NAV_ITEMS: NavItem[] = [
  'Account',
  'Permissions',
  'Appearance',
];
```

- [ ] **Step 3: Add `PermissionsPane` component**

Insert the following before `function AppearancePane()`:

```typescript
function PermissionsPane({
  yoloMode,
  onYoloModeChange,
}: {
  yoloMode: boolean;
  onYoloModeChange: (v: boolean) => void;
}) {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--text)',
          marginBottom: 6,
        }}
      >
        Permissions
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--text-dim)',
          marginBottom: 32,
        }}
      >
        Control how Claude asks for access to tools and files.
      </p>

      {/* YOLO mode toggle */}
      <section style={{ marginBottom: 32 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            color: 'var(--text-mute)',
            marginBottom: 10,
          }}
        >
          YOLO mode
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            userSelect: 'none' as const,
          }}
        >
          {/* Toggle track */}
          <div
            onClick={() => onYoloModeChange(!yoloMode)}
            style={{
              width: 40,
              height: 22,
              borderRadius: 11,
              background: yoloMode ? 'var(--accent)' : 'var(--bg-panel)',
              border: '1px solid var(--border)',
              position: 'relative' as const,
              cursor: 'pointer',
              transition: 'background 0.15s',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: 'absolute' as const,
                top: 2,
                left: yoloMode ? 20 : 2,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: yoloMode ? '#fff' : 'var(--text-mute)',
                transition: 'left 0.15s',
              }}
            />
          </div>

          <div>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              Skip all permission checks
            </div>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--text-mute)',
                marginTop: 2,
              }}
            >
              Claude will execute every tool call without asking. Only enable if you
              trust the task completely.
            </div>
          </div>
        </label>
      </section>

      {/* Policy note */}
      <section>
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--text-dim)',
            lineHeight: 1.6,
          }}
        >
          Project-specific allow/deny rules are saved to{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            .workbench/policy.toml
          </span>{' '}
          in each project directory. Click "Always allow in project" on any
          permission prompt to add a rule automatically.
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Thread props through the Settings export and render PermissionsPane**

Update the main `export default function SettingsOverlay` signature and body to accept and thread the new props:

```typescript
export default function SettingsOverlay({
  onClose,
  yoloMode,
  onYoloModeChange,
}: Props) {
  const [active, setActive] = useState<NavItem>('Account');

  // … existing nav/layout code …

  function renderPane() {
    switch (active) {
      case 'Account':     return <AccountPane />;
      case 'Permissions': return <PermissionsPane yoloMode={yoloMode} onYoloModeChange={onYoloModeChange} />;
      case 'Appearance':  return <AppearancePane />;
      default:            return null;
    }
  }

  // … rest of render unchanged …
}
```

- [ ] **Step 5: TypeScript compile check**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. Commit: `feat(frontend): add Permissions pane with YOLO mode toggle to Settings`

---

### Task 11: Frontend — fix `handlePermAlwaysAllow` to pass `allow: true`

**Files:**
- Modify: `src/App.tsx`

The existing `handlePermAlwaysAllow` calls `save_policy` but does not pass `allow`. Now that `save_policy` accepts an explicit `allow` parameter, fix the call site:

- [ ] **Step 1: Update the handler**

Replace the `handlePermAlwaysAllow` function body (around line 1199):

```typescript
  async function handlePermAlwaysAllow(id: string, tool: string, pattern: string) {
    const workDir = currentSession?.worktreePath ?? projectPath;
    await invoke('save_policy', { projectPath: workDir, tool, pattern, allow: true });
    await invoke('resolve_permission', { id, allow: true });
    dismissPermission(id);
  }
```

Note: `always` parameter has been removed from `resolve_permission` — the Rust command no longer needs it (the policy is saved separately via `save_policy`). The `resolve_permission` IPC now only takes `id` and `allow`.

- [ ] **Step 2: Update `handlePermAllow` and `handlePermDeny`**

No changes needed — they already call `resolve_permission` with only `id` and `allow`.

- [ ] **Step 3: TypeScript compile check**

```bash
cd /Users/sam/workspace/claude-window && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. Commit: `fix(frontend): pass allow:true and projectPath correctly in handlePermAlwaysAllow`

---

### Task 12: End-to-end smoke test

- [ ] **Step 1: Build in dev mode**

```bash
cd /Users/sam/workspace/claude-window && npm run tauri dev -- --no-watch 2>&1 | head -40
```

Expected: Tauri builds without errors, app window opens.

- [ ] **Step 2: Manual permission flow test (non-YOLO)**

1. Open a project in the app.
2. Start a new chat with the prompt: `Write a file called test-perm.txt with content "hello"`.
3. Verify the permission modal appears with tool `WRITE`, path `test-perm.txt`, risk `high`.
4. Click "Allow once" — verify the file is written and the session completes.
5. Repeat; click "Deny" — verify the session reports a tool error and does not write the file.

- [ ] **Step 3: Always allow + policy persistence test**

1. Start a new chat: `Write a file called test-perm2.txt with content "hello"`.
2. Click "Always allow in project" — verify the session completes.
3. Check that `{project_path}/.workbench/policy.toml` exists and contains a `[[rules]]` entry with `tool = "Write"` and `allow = true`.
4. Start another chat with the same write prompt — verify no permission dialog appears (the policy pre-populates `--allowedTools`).

- [ ] **Step 4: YOLO mode test**

1. Open Settings > Permissions.
2. Toggle "Skip all permission checks" on.
3. Start a new chat: `Write a file called test-yolo.txt with content "yolo"`.
4. Verify no permission dialog appears and the file is written immediately.
5. Toggle YOLO mode off; verify subsequent chats show permission dialogs again.

- [ ] **Step 5: cargo test**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass. Commit: `test: phase 2 smoke-test verification complete`

---

### Task 13: Final cleanup and git tag

- [ ] **Step 1: Remove dead `always` parameter from `resolve_permission` call sites**

Verify no remaining TypeScript calls pass `always: …` to `resolve_permission`. Search:

```bash
grep -r "always" /Users/sam/workspace/claude-window/src/ --include="*.tsx" --include="*.ts"
```

Expected: zero matches for `always:` in the context of `resolve_permission`.

- [ ] **Step 2: Add `.workbench/` to project `.gitignore` if missing**

```bash
grep -q '\.workbench' /Users/sam/workspace/claude-window/.gitignore || echo '.workbench/' >> /Users/sam/workspace/claude-window/.gitignore
```

This prevents `policy.toml` and other workbench artefacts from being committed to the user's project repos.

- [ ] **Step 3: Final cargo test + TypeScript check**

```bash
cd src-tauri && cargo test 2>&1 | tail -5
cd /Users/sam/workspace/claude-window && npx tsc --noEmit 2>&1 | head -10
```

Expected: both clean. Commit: `chore: phase 2 cleanup — remove stale always param, add .workbench to gitignore`

---

### Summary of files changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `toml = "0.8"` dependency |
| `src-tauri/src/lib.rs` | Add `PermissionRegistry`, extend `AppState`, add `PolicyFile`/`PolicyRule`/`load_policy`/`policy_check`/`glob_match`/`policy_to_claude_flags`/`classify_risk`, update `run_agent` signature and body, add `resolve_permission`, add `save_policy`, document `summarize_session` exception, register new commands in `invoke_handler` |
| `src/App.tsx` | Add `yoloMode` state, load/persist from profile, pass to `start_task`, fix `handlePermAlwaysAllow`, wire to `SettingsOverlay` |
| `src/components/Settings.tsx` | Add `Props.yoloMode`/`onYoloModeChange`, add `PermissionsPane`, add 'Permissions' nav item, thread props through `renderPane` |

### Policy TOML reference

```toml
# .workbench/policy.toml
# Rules are evaluated top-to-bottom; first match wins.
# Tool names: Read, Write, Edit, MultiEdit, Bash, Glob, Grep, LS,
#             Task, WebFetch, WebSearch, TodoWrite, NotebookRead, NotebookEdit
# Pattern:    glob matched against the tool's primary argument.
#             * = any chars except /
#             ** = any chars including /
#             "src/**" matches all files under src/

[[rules]]
tool    = "Read"
pattern = "**"
allow   = true

[[rules]]
tool    = "Write"
pattern = "src/**"
allow   = true

[[rules]]
tool    = "Bash"
pattern = "cargo test*"
allow   = true

[[rules]]
tool    = "Bash"
pattern = "**"
allow   = false
```
