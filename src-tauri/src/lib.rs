#![allow(unused_imports)]

mod term;

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;
use std::process::Stdio;

// ── AgentEvent (emitted to renderer) ─────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AgentEvent {
    Token { content: String },
    Plan { items: Vec<PlanItem> },
    Tool { id: String, tool: String, path: String, detail: String, status: String },
    Diff { patch: String },
    /// Emitted once per `start_task` after we observe the Claude Code session
    /// id in the stream-json output. The frontend stores this so subsequent
    /// turns can pass it back to `start_task` and resume the same conversation.
    Session { id: String },
    #[allow(dead_code)]
    Permission { id: String, tool: String, path: String, detail: String, risk: String },
    Done,
    Error { message: String },
    Stopped,
    Thinking { content: String, done: bool, duration_ms: u64 },
    Usage { input: u64, output: u64, cache_read: u64, cache_creation: u64 },
}

// ── Task registry (for stop_task) ─────────────────────────────────────────────

type TaskRegistry = Arc<tokio::sync::Mutex<HashMap<String, oneshot::Sender<()>>>>;

struct AppState {
    tasks: TaskRegistry,
}

impl Default for AppState {
    fn default() -> Self {
        AppState { tasks: Arc::new(tokio::sync::Mutex::new(HashMap::new())) }
    }
}

/// Wraps every emitted `agent-event` with the workbench task/session id that
/// produced it. `app.emit` is a global broadcast — every renderer-side
/// listener receives every emit. Without this id, two concurrent sessions
/// would each apply each other's events. Frontend listeners must filter by
/// `task_id === their captured session id`.
#[derive(Serialize, Clone, Debug)]
struct TaggedAgentEvent {
    task_id: String,
    #[serde(flatten)]
    event: AgentEvent,
}

fn emit_agent(app: &AppHandle, task_id: &str, event: AgentEvent) {
    let _ = app.emit("agent-event", &TaggedAgentEvent {
        task_id: task_id.to_string(),
        event,
    });
}

#[derive(Serialize, Clone, Debug)]
struct PlanItem {
    id: String,
    label: String,
    status: String,
}

// ── Claude Code tool helpers ──────────────────────────────────────────────────

fn cc_tool_display(name: &str) -> &'static str {
    match name {
        "Read"           => "READ",
        "Write"          => "WRITE",
        "Edit"           => "EDIT",
        "MultiEdit"      => "EDIT",
        "Bash"           => "SHELL",
        "Glob"           => "GLOB",
        "Grep"           => "GREP",
        "LS"             => "LIST",
        "Task"           => "AGENT",
        "WebFetch"       => "FETCH",
        "WebSearch"      => "SEARCH",
        "TodoWrite"      => "TODO",
        "NotebookRead"   => "READ",
        "NotebookEdit"   => "EDIT",
        _                => "TOOL",
    }
}

fn cc_tool_path(name: &str, input: &Value) -> String {
    match name {
        "Read" | "Write" | "Edit" | "MultiEdit" =>
            input["file_path"].as_str().unwrap_or("").to_string(),
        "Glob"  => input["pattern"].as_str().unwrap_or("").to_string(),
        "Grep"  => input["path"].as_str()
                       .unwrap_or_else(|| input["pattern"].as_str().unwrap_or(""))
                       .to_string(),
        // Bash: leave path empty — the full command goes in `detail`
        // and is rendered below the SHELL chip on its own line.
        "Bash"  => String::new(),
        _       => String::new(),
    }
}

fn cc_tool_detail(name: &str, input: &Value) -> String {
    match name {
        "Bash"  => input["command"].as_str().unwrap_or("").to_string(),
        "Grep"  => input["pattern"].as_str().unwrap_or("").to_string(),
        "Write" => {
            let content = input["content"].as_str().unwrap_or("");
            format!("{} bytes", content.len())
        }
        "WebFetch" | "WebSearch" =>
            input["url"].as_str()
                .or_else(|| input["query"].as_str())
                .unwrap_or("").to_string(),
        _ => String::new(),
    }
}

// ── Plan extraction ───────────────────────────────────────────────────────────

fn extract_plan(text: &str) -> Vec<PlanItem> {
    let mut items = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        let digits_end = t.find(|c: char| !c.is_ascii_digit()).unwrap_or(0);
        if digits_end == 0 { continue; }
        let rest = &t[digits_end..];
        let label = if let Some(l) = rest.strip_prefix('.') { l }
                    else if let Some(l) = rest.strip_prefix(')') { l }
                    else { continue };
        let label = label.trim().to_string();
        if !label.is_empty() {
            let n = items.len() + 1;
            items.push(PlanItem {
                id: n.to_string(),
                label,
                status: if n == 1 { "active".into() } else { "pending".into() },
            });
        }
    }
    items
}

// ── Agent runner: shells out to `claude` CLI ──────────────────────────────────

async fn run_agent(
    app: AppHandle,
    task_id: String,
    project_path: String,
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
        .current_dir(&project_path)
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

    let mut child = match command.spawn()
    {
        Ok(c) => c,
        Err(e) => {
            emit_agent(&app, &task_id, AgentEvent::Error {
                message: format!(
                    "Could not launch shell ({shell}): {e}."
                ),
            });
            return;
        }
    };

    // Collect stderr in a background task so we can report it on failure.
    let stderr_task = {
        let stderr = child.stderr.take().expect("stderr piped");
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            let mut buf = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim().to_string();
                if !line.is_empty() {
                    buf.push_str(&line);
                    buf.push('\n');
                }
            }
            buf
        })
    };

    let stdout = child.stdout.take().expect("stdout piped");
    let mut lines = BufReader::new(stdout).lines();
    let mut plan_emitted = false;
    let mut task_complete = false;
    let mut session_id_emitted = false;
    let mut cancelled = false;

    loop {
        let maybe_line = tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                cancelled = true;
                let _ = child.kill().await;
                break;
            }
            result = lines.next_line() => result,
        };
        let line = match maybe_line {
            Ok(Some(l)) => l.trim().to_string(),
            _ => break,
        };
        if line.is_empty() { continue; }

        let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };

        // Capture and forward the Claude session id the first time we see it.
        // Stream-json events of any type carry `session_id` once initialized.
        if !session_id_emitted {
            if let Some(sid) = ev["session_id"].as_str() {
                if !sid.is_empty() {
                    emit_agent(&app, &task_id, AgentEvent::Session { id: sid.to_string() });
                    session_id_emitted = true;
                }
            }
        }

        match ev["type"].as_str().unwrap_or("") {
            // Live streaming chunk (enabled by --include-partial-messages).
            // Forward each text_delta as a Token event so the UI fills in
            // word-by-word instead of one big block per assistant turn.
            "stream_event" => {
                let inner = &ev["event"];
                if inner["type"].as_str() == Some("content_block_delta") {
                    let delta = &inner["delta"];
                    if delta["type"].as_str() == Some("text_delta") {
                        if let Some(text) = delta["text"].as_str() {
                            if !text.is_empty() {
                                emit_agent(&app, &task_id, AgentEvent::Token {
                                    content: text.to_string(),
                                });
                            }
                        }
                    } else if delta["type"].as_str() == Some("thinking_delta") {
                        if let Some(thinking) = delta["thinking"].as_str() {
                            if !thinking.is_empty() {
                                emit_agent(&app, &task_id, AgentEvent::Thinking {
                                    content: thinking.to_string(),
                                    done: false,
                                    duration_ms: 0,
                                });
                            }
                        }
                    }
                }
            }

            "assistant" => {
                let blocks = match ev["message"]["content"].as_array() {
                    Some(b) => b.clone(),
                    None    => continue,
                };
                for block in &blocks {
                    match block["type"].as_str().unwrap_or("") {
                        "thinking" => {
                            if let Some(content) = block["thinking"].as_str() {
                                if !content.is_empty() {
                                    emit_agent(&app, &task_id, AgentEvent::Thinking {
                                        content: content.to_string(),
                                        done: true,
                                        duration_ms: 0,
                                    });
                                }
                            }
                        }
                        "text" => {
                            // Don't re-emit the full text — stream_event deltas
                            // already covered it. Still run plan extraction
                            // against the consolidated text, since detecting a
                            // numbered plan mid-stream would be flaky.
                            let text = block["text"].as_str().unwrap_or("");
                            if text.is_empty() { continue; }
                            if !plan_emitted {
                                let items = extract_plan(text);
                                if !items.is_empty() {
                                    emit_agent(&app, &task_id, AgentEvent::Plan { items });
                                    plan_emitted = true;
                                }
                            }
                        }
                        "tool_use" => {
                            let id    = block["id"].as_str().unwrap_or("").to_string();
                            let name  = block["name"].as_str().unwrap_or("");
                            let input = &block["input"];
                            emit_agent(&app, &task_id, AgentEvent::Tool {
                                id,
                                tool:   cc_tool_display(name).to_string(),
                                path:   cc_tool_path(name, input),
                                detail: cc_tool_detail(name, input),
                                status: "running".into(),
                            });
                        }
                        _ => {}
                    }
                }
            }

            "user" => {
                if let Some(blocks) = ev["message"]["content"].as_array() {
                    for block in blocks {
                        if block["type"].as_str() == Some("tool_result") {
                            let id = block["tool_use_id"].as_str().unwrap_or("").to_string();
                            emit_agent(&app, &task_id, AgentEvent::Tool {
                                id,
                                tool:   "TOOL".into(),
                                path:   String::new(),
                                detail: String::new(),
                                status: "done".into(),
                            });
                        }
                    }
                }
            }

            "result" => {
                task_complete = true;
                // Emit usage stats if present
                if let Some(usage) = ev.get("usage") {
                    let input = usage["input_tokens"].as_u64().unwrap_or(0);
                    let output = usage["output_tokens"].as_u64().unwrap_or(0);
                    let cache_read = usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
                    let cache_creation = usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
                    if input > 0 || output > 0 {
                        emit_agent(&app, &task_id, AgentEvent::Usage { input, output, cache_read, cache_creation });
                    }
                }
                if ev["subtype"].as_str() == Some("error") || ev["is_error"].as_bool() == Some(true) {
                    let msg = ev["result"].as_str()
                        .or_else(|| ev["error"]["message"].as_str())
                        .unwrap_or("Claude Code reported an error");
                    emit_agent(&app, &task_id, AgentEvent::Error { message: msg.to_string() });
                    let _ = child.kill().await;
                    return;
                }
                break;
            }

            _ => {}
        }
    }

    let _ = child.wait().await;

    if cancelled {
        // Emit any partial diff before reporting stopped
        if let Ok(diff_out) = std::process::Command::new("git")
            .args(["diff", "HEAD"])
            .current_dir(&project_path)
            .output()
        {
            let patch = String::from_utf8_lossy(&diff_out.stdout).to_string();
            if !patch.trim().is_empty() {
                emit_agent(&app, &task_id, AgentEvent::Diff { patch });
            }
        }
        emit_agent(&app, &task_id, AgentEvent::Stopped);
        return;
    }

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !task_complete {
        let message = if stderr_output.trim().is_empty() {
            "Claude Code exited without completing. Run `claude auth login` in your terminal and try again.".to_string()
        } else {
            format!("Claude Code error: {}", stderr_output.trim())
        };
        emit_agent(&app, &task_id, AgentEvent::Error { message });
        return;
    }

    // Emit diff if the agent made any changes
    if let Ok(diff_out) = std::process::Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&project_path)
        .output()
    {
        let patch = String::from_utf8_lossy(&diff_out.stdout).to_string();
        if !patch.trim().is_empty() {
            emit_agent(&app, &task_id, AgentEvent::Diff { patch });
        }
    }

    emit_agent(&app, &task_id, AgentEvent::Done);
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    project_path: String,
    prompt: String,
    resume_session: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.tasks.lock().await.insert(task_id.clone(), cancel_tx);
    let tasks = state.tasks.clone();
    let tid = task_id.clone();
    tokio::spawn(async move {
        run_agent(app, task_id, project_path, prompt, resume_session, model, cancel_rx).await;
        // Remove from registry once done (natural completion or cancel)
        tasks.lock().await.remove(&tid);
    });
    Ok(())
}

#[tauri::command]
async fn stop_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    if let Some(tx) = state.tasks.lock().await.remove(&task_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
async fn save_profile(data: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir  = Path::new(&home).join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("profile.json"), data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_appearance(data: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir  = Path::new(&home).join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("appearance.json"), data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_profile() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = Path::new(&home).join(".workbench").join("profile.json");
    match std::fs::read_to_string(&path) {
        Ok(s)  => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn save_sessions(data: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir  = Path::new(&home).join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp   = dir.join("sessions.json.tmp");
    let final_ = dir.join("sessions.json");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &final_).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_sessions() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = Path::new(&home).join(".workbench").join("sessions.json");
    match std::fs::read_to_string(&path) {
        Ok(s)  => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn choose_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();
    app.dialog()
        .file()
        .set_title("Select Project Directory")
        .pick_folder(move |folder| {
            let path = folder.and_then(|f| f.into_path().ok());
            let _ = tx.send(path);
        });
    let result = rx.await.map_err(|e| e.to_string())?;
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn get_git_remote_url(project_path: String) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let https_url = if raw.starts_with("git@") {
        let without_prefix = &raw["git@".len()..];
        let colon_pos = without_prefix.find(':')
            .ok_or_else(|| format!("Unexpected SSH URL format: {raw}"))?;
        let host = &without_prefix[..colon_pos];
        let path = &without_prefix[colon_pos + 1..];
        let path = path.strip_suffix(".git").unwrap_or(path);
        format!("https://{host}/{path}")
    } else {
        raw.strip_suffix(".git").unwrap_or(&raw).to_string()
    };

    Ok(https_url)
}

#[tauri::command]
async fn get_current_branch(project_path: String) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn git_commit(project_path: String, message: String) -> Result<(), String> {
    let add = std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
    }

    let commit = std::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;
    if !commit.status.success() {
        return Err(String::from_utf8_lossy(&commit.stderr).trim().to_string());
    }

    Ok(())
}

#[tauri::command]
async fn git_discard(project_path: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["checkout", "--", "."])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let clean = std::process::Command::new("git")
        .args(["clean", "-fd", "."])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !clean.status.success() {
        return Err(String::from_utf8_lossy(&clean.stderr).trim().to_string());
    }

    Ok(())
}

// ── Worktree management ───────────────────────────────────────────────────────

fn short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    format!("{:06x}", (nanos ^ std::process::id() as u64) & 0xFFFFFF)
}

#[derive(Serialize)]
struct WorktreeInfo {
    path: String,
    branch: String,
}

#[tauri::command]
async fn create_worktree(project_path: String) -> Result<WorktreeInfo, String> {
    let id = short_id();
    let worktree_path = Path::new(&project_path)
        .join(".worktrees")
        .join(format!("wb-{id}"));
    let branch_name = format!("wb/{id}");

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let path_str = worktree_path.to_string_lossy().to_string();

    let output = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch_name, &path_str])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(WorktreeInfo { path: path_str, branch: branch_name })
}

#[tauri::command]
async fn remove_worktree(project_path: String, worktree_path: String) -> Result<(), String> {
    // Best-effort: force-remove the worktree. Ignore failure if it's already gone.
    let _ = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&project_path)
        .output();
    Ok(())
}

// ── Automations persistence ───────────────────────────────────────────────────

#[tauri::command]
async fn load_automations() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = Path::new(&home).join(".workbench").join("automations.json");
    match std::fs::read_to_string(&path) {
        Ok(s)  => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn save_automations(data: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir  = Path::new(&home).join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp   = dir.join("automations.json.tmp");
    let final_ = dir.join("automations.json");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &final_).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Plugins / marketplace ─────────────────────────────────────────────────────

#[derive(Serialize)]
struct InstalledPlugin {
    name: String,
    marketplace: String,
    version: String,
    install_path: String,
}

/// Read `~/.claude/plugins/installed_plugins.json` and flatten the
/// `{ "<name>@<marketplace>": [{...installs}] }` map into a list.
#[tauri::command]
async fn list_installed_plugins() -> Result<Vec<InstalledPlugin>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = Path::new(&home).join(".claude").join("plugins").join("installed_plugins.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s)  => s,
        Err(_) => return Ok(Vec::new()),
    };
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(map) = v["plugins"].as_object() {
        for (key, entries) in map {
            // Key is "<name>@<marketplace>"
            let (name, marketplace) = match key.rsplit_once('@') {
                Some((n, m)) => (n.to_string(), m.to_string()),
                None         => (key.clone(), String::new()),
            };
            if let Some(arr) = entries.as_array() {
                for entry in arr {
                    out.push(InstalledPlugin {
                        name: name.clone(),
                        marketplace: marketplace.clone(),
                        version: entry["version"].as_str().unwrap_or("unknown").to_string(),
                        install_path: entry["installPath"].as_str().unwrap_or("").to_string(),
                    });
                }
            }
        }
    }
    Ok(out)
}

#[derive(Serialize)]
struct MarketplacePlugin {
    name: String,
    marketplace: String,
    description: String,
    category: String,
    author: String,
    homepage: String,
}

/// Walk every `~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json`
/// and emit a flat catalog of all known plugins.
#[tauri::command]
async fn list_marketplace_plugins() -> Result<Vec<MarketplacePlugin>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir  = Path::new(&home).join(".claude").join("plugins").join("marketplaces");
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e)  => e,
        Err(_) => return Ok(out),
    };
    for ent in entries.flatten() {
        let manifest = ent.path().join(".claude-plugin").join("marketplace.json");
        let raw = match std::fs::read_to_string(&manifest) {
            Ok(s)  => s,
            Err(_) => continue,
        };
        let v: Value = match serde_json::from_str(&raw) {
            Ok(v)  => v,
            Err(_) => continue,
        };
        let dir_name = ent.file_name().to_string_lossy().to_string();
        let marketplace = v["name"].as_str()
            .map(|s| s.to_string())
            .unwrap_or(dir_name);
        let plugins = match v["plugins"].as_array() {
            Some(p) => p,
            None    => continue,
        };
        for p in plugins {
            let author = p["author"]["name"].as_str()
                .or_else(|| p["author"].as_str())
                .unwrap_or("")
                .to_string();
            out.push(MarketplacePlugin {
                name:        p["name"].as_str().unwrap_or("").to_string(),
                marketplace: marketplace.clone(),
                description: p["description"].as_str().unwrap_or("").to_string(),
                category:    p["category"].as_str().unwrap_or("").to_string(),
                author,
                homepage:    p["homepage"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    Ok(out)
}

/// Run `claude plugin install <name>@<marketplace>` and return combined output.
#[tauri::command]
async fn install_plugin(name: String, marketplace: String) -> Result<String, String> {
    let arg = if marketplace.is_empty() { name } else { format!("{name}@{marketplace}") };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", &format!("claude plugin install {} 2>&1", shell_escape(&arg))])
        .output()
        .map_err(|e| e.to_string())?;
    let combined = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        return Err(if combined.trim().is_empty() {
            "claude plugin install failed".to_string()
        } else {
            combined
        });
    }
    Ok(combined)
}

#[tauri::command]
async fn uninstall_plugin(name: String, marketplace: String) -> Result<String, String> {
    let arg = if marketplace.is_empty() { name } else { format!("{name}@{marketplace}") };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", &format!("claude plugin uninstall {} 2>&1", shell_escape(&arg))])
        .output()
        .map_err(|e| e.to_string())?;
    let combined = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        return Err(if combined.trim().is_empty() {
            "claude plugin uninstall failed".to_string()
        } else {
            combined
        });
    }
    Ok(combined)
}

// ── File / path utilities ─────────────────────────────────────────────────────

/// Open `path` in the OS-default handler. Used to make tool-call file paths
/// clickable (e.g. opens the file in the user's default editor).
/// Resolves relative paths against `base_path` if provided.
#[tauri::command]
async fn open_path(path: String, base_path: Option<String>) -> Result<(), String> {
    let resolved = if Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else if let Some(base) = base_path {
        Path::new(&base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    let p = resolved.to_string_lossy().to_string();
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&p).status()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", "", &p]).status()
    } else {
        std::process::Command::new("xdg-open").arg(&p).status()
    };
    match result {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("open failed with exit code {}", s.code().unwrap_or(-1))),
        Err(e) => Err(e.to_string()),
    }
}

/// Read a file for in-app preview. Refuses binaries and caps content at
/// `MAX_BYTES` so the renderer never has to deal with multi-MB blobs.
#[derive(Serialize)]
struct FilePreview {
    path: String,
    content: String,
    language: String,
    size_bytes: u64,
    truncated: bool,
    binary: bool,
}

#[tauri::command]
async fn read_file(path: String, base_path: Option<String>) -> Result<FilePreview, String> {
    const MAX_BYTES: u64 = 2 * 1024 * 1024; // 2 MB cap

    let resolved: std::path::PathBuf = if Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else if let Some(base) = base_path {
        Path::new(&base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    let meta = std::fs::metadata(&resolved).map_err(|e| format!("stat {}: {e}", resolved.display()))?;
    let size = meta.len();

    let bytes_to_read = std::cmp::min(size, MAX_BYTES) as usize;
    let mut buf = vec![0u8; bytes_to_read];
    use std::io::Read;
    let mut f = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;

    // Heuristic: if the chunk has any NUL bytes treat as binary.
    let binary = buf.contains(&0u8);
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&buf).to_string()
    };

    let language = resolved.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    Ok(FilePreview {
        path: resolved.to_string_lossy().to_string(),
        content,
        language,
        size_bytes: size,
        truncated: size > MAX_BYTES,
        binary,
    })
}

/// Walk the project tree and return paths matching `query` (substring, case-
/// insensitive). Skips common build/VCS directories. Used by @file autocomplete.
#[tauri::command]
async fn list_project_files(
    project_path: String,
    query: String,
    limit: usize,
) -> Result<Vec<String>, String> {
    const SKIP_DIRS: &[&str] = &[
        ".git", "node_modules", "target", "dist", "build",
        ".next", ".nuxt", ".cache", ".turbo", ".vite",
        "__pycache__", ".venv", "venv", ".idea", ".vscode",
        ".worktrees",
    ];

    let q_lower = query.to_lowercase();
    let root = std::path::PathBuf::from(&project_path);
    if !root.exists() {
        return Err(format!("project path does not exist: {project_path}"));
    }

    let mut out: Vec<String> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root.clone()];

    while let Some(dir) = stack.pop() {
        if out.len() >= limit { break; }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e)  => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') && name_str.as_ref() != "." && name_str.as_ref() != ".." {
                // Skip dotfiles/dotdirs (already includes .git etc.)
                if SKIP_DIRS.iter().any(|d| *d == name_str.as_ref())
                    || name_str.starts_with('.') {
                    continue;
                }
            }
            if path.is_dir() {
                if SKIP_DIRS.iter().any(|d| *d == name_str.as_ref()) { continue; }
                stack.push(path);
            } else if path.is_file() {
                let rel = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().to_string();
                if q_lower.is_empty() || rel.to_lowercase().contains(&q_lower) {
                    out.push(rel);
                    if out.len() >= limit { break; }
                }
            }
        }
    }

    // Prefer exact-prefix matches, then alphabetical.
    out.sort_by(|a, b| {
        let ap = a.to_lowercase().starts_with(&q_lower);
        let bp = b.to_lowercase().starts_with(&q_lower);
        match (ap, bp) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _             => a.cmp(b),
        }
    });
    Ok(out)
}

/// Save a base64-encoded image (or arbitrary blob) into the workbench
/// attachments dir for a session, returning the absolute path. Lets the
/// frontend hand pasted/dropped images to Claude as a file path it can read.
#[tauri::command]
async fn save_attachment(
    session_id: String,
    extension: String,
    data_b64: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = Path::new(&home).join(".workbench").join("attachments").join(&session_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let ext = if extension.is_empty() { "bin".to_string() } else { extension };
    let filename = format!("{ts}.{ext}");
    let path = dir.join(&filename);

    let bytes = general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

// ── summarize_session (Haiku title) ──────────────────────────────────────────

#[tauri::command]
async fn summarize_session(first_user: String, last_assistant: String) -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let prompt = format!(
        "Summarize this in 3-6 words as a title. Output only the title, no quotes, no period.\n\nUser: {}\n\nAssistant: {}",
        &first_user.chars().take(4000).collect::<String>(),
        &last_assistant.chars().take(4000).collect::<String>(),
    );
    let escaped = shell_escape(&prompt);
    let cmd = format!("claude --print --model haiku --dangerously-skip-permissions {escaped}");
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        tokio::task::spawn_blocking(move || {
            std::process::Command::new(&shell)
                .args(["-l", "-c", &cmd])
                .output()
        }),
    ).await
        .map_err(|_| "summarize_session timed out".to_string())?
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let raw = String::from_utf8_lossy(&output.stdout);
    let title = raw.lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("New task")
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_end_matches('.')
        .trim();
    let title = if title.len() > 60 { &title[..57] } else { title };
    Ok(title.to_string())
}

// ── list_dir / write_file / git_status_porcelain ──────────────────────────────

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    const SKIP: &[&str] = &[".git","node_modules","target","dist","build",".next",".nuxt",".cache",".turbo",".vite","__pycache__",".venv","venv",".worktrees"];
    let mut entries = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if SKIP.iter().any(|s| *s == name) { continue; }
        let meta = match ent.metadata() { Ok(m) => m, Err(_) => continue };
        entries.push(DirEntry {
            name: name.clone(),
            path: ent.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
        });
    }
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });
    Ok(entries)
}

#[tauri::command]
async fn write_file(path: String, content: String, base_path: Option<String>) -> Result<(), String> {
    let resolved: std::path::PathBuf = if std::path::Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else if let Some(base) = base_path {
        std::path::Path::new(&base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };
    let home = std::env::var("HOME").unwrap_or_default();
    let canonical = resolved.canonicalize()
        .or_else(|_| resolved.parent().map(|p| p.to_path_buf()).ok_or(std::io::Error::new(std::io::ErrorKind::NotFound, "no parent")))
        .map_err(|e| e.to_string())?;
    if !canonical.starts_with(&home) {
        return Err(format!("write_file: path outside home: {}", resolved.display()));
    }
    let tmp = resolved.with_extension("tmp.wb");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &resolved).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn git_status_porcelain(project_path: String) -> Result<Vec<(String, String)>, String> {
    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    let result = text.lines()
        .filter_map(|l| {
            if l.len() < 3 { return None; }
            let status = l[0..2].trim().to_string();
            let file = l[3..].trim().to_string();
            if file.is_empty() { return None; }
            Some((file, status))
        })
        .collect();
    Ok(result)
}

/// Wrap a value so it survives a single round-trip through `sh -c`.
/// Uses single-quote escaping: `foo'bar` → `'foo'\''bar'`.
fn shell_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' { out.push_str("'\\''"); } else { out.push(ch); }
    }
    out.push('\'');
    out
}

// ── App entry point ───────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(term::TerminalState::default())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_task,
            stop_task,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let state: tauri::State<'_, term::TerminalState> = app.state();
                term::shutdown_all_state(&state);
            }
        });
}
