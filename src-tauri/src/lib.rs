#![allow(unused_imports)]

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;
use futures::StreamExt;

// ── AgentEvent (emitted to renderer) ─────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AgentEvent {
    Token { content: String },
    Plan { items: Vec<PlanItem> },
    Tool { id: String, tool: String, path: String, detail: String, status: String },
    Diff { patch: String },
    Permission { id: String, tool: String, path: String, detail: String, risk: String },
    Done,
    Error { message: String },
}

#[derive(Serialize, Clone, Debug)]
struct PlanItem {
    id: String,
    label: String,
    status: String,
}

// ── Permission state ──────────────────────────────────────────────────────────

#[derive(Debug)]
struct PermResp { allow: bool, always: bool }

type PermMap = Arc<Mutex<HashMap<String, oneshot::Sender<PermResp>>>>;

#[derive(Clone)]
struct AgentState {
    perm_map: PermMap,
}

// ── Policy ────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Serialize, Default, Clone, Debug)]
struct Policy {
    #[serde(default)]
    allow: Vec<PolicyEntry>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
struct PolicyEntry {
    tool: String,
    pattern: String,
}

impl Policy {
    fn is_allowed(&self, tool: &str, detail: &str) -> bool {
        self.allow.iter().any(|e| {
            e.tool == tool && detail.contains(e.pattern.as_str())
        })
    }
}

// ── Risk detection and tool helpers ──────────────────────────────────────────

fn risk_level(command: &str) -> Option<&'static str> {
    let c = command.to_lowercase();
    let high = ["rm -rf", "rm -r ", "rm -f ", "git reset --hard",
                "git push --force", "git push -f", "sudo ", "mkfs",
                "dd if=", "chmod -r 777", "> /dev/", "truncate "];
    let low  = ["rm ", "mv ", "git clean", "chmod "];
    if high.iter().any(|p| c.contains(p)) { return Some("high"); }
    if low .iter().any(|p| c.contains(p)) { return Some("low");  }
    None
}

fn tool_display_name(api_name: &str) -> &'static str {
    match api_name {
        "read_file"       => "READ",
        "write_file"      => "WRITE",
        "edit_file"       => "EDIT",
        "bash"            => "SHELL",
        "glob"            => "GLOB",
        "grep"            => "GREP",
        "list_directory"  => "LIST",
        _                 => "TOOL",
    }
}

fn tool_path(api_name: &str, input: &Value) -> String {
    match api_name {
        "read_file" | "write_file" | "edit_file" =>
            input["path"].as_str().unwrap_or("").to_string(),
        "glob" =>
            input["pattern"].as_str().unwrap_or("").to_string(),
        "grep" =>
            input["path"].as_str().unwrap_or("").to_string(),
        "bash" =>
            input["command"].as_str().unwrap_or("").chars().take(40).collect(),
        _ => String::new(),
    }
}

fn tool_detail(api_name: &str, input: &Value) -> String {
    match api_name {
        "bash" => input["command"].as_str().unwrap_or("").chars().take(80).collect(),
        "grep" => input["pattern"].as_str().unwrap_or("").to_string(),
        "write_file" => {
            let content = input["content"].as_str().unwrap_or("");
            format!("{} bytes", content.len())
        },
        _ => String::new(),
    }
}

// ── Tool execution ────────────────────────────────────────────────────────────

async fn exec_tool(
    app: &AppHandle,
    state: &AgentState,
    policy: &Policy,
    project_path: &str,
    _tool_id: &str,
    tool_name: &str,
    input: &Value,
) -> String {
    match tool_name {
        "read_file" => {
            let rel = input["path"].as_str().unwrap_or("");
            let full = Path::new(project_path).join(rel);
            std::fs::read_to_string(&full)
                .unwrap_or_else(|e| format!("Error reading {rel}: {e}"))
        }

        "write_file" => {
            let rel     = input["path"].as_str().unwrap_or("");
            let content = input["content"].as_str().unwrap_or("");
            let full = Path::new(project_path).join(rel);
            if let Some(parent) = full.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&full, content) {
                Ok(_)  => format!("Wrote {} bytes to {rel}", content.len()),
                Err(e) => format!("Error writing {rel}: {e}"),
            }
        }

        "edit_file" => {
            let rel     = input["path"].as_str().unwrap_or("");
            let old_str = input["old_string"].as_str().unwrap_or("");
            let new_str = input["new_string"].as_str().unwrap_or("");
            let full = Path::new(project_path).join(rel);
            match std::fs::read_to_string(&full) {
                Ok(contents) => {
                    if !contents.contains(old_str) {
                        return format!("Error: old_string not found in {rel}");
                    }
                    let updated = contents.replacen(old_str, new_str, 1);
                    match std::fs::write(&full, &updated) {
                        Ok(_)  => format!("Edited {rel}"),
                        Err(e) => format!("Error writing {rel}: {e}"),
                    }
                }
                Err(e) => format!("Error reading {rel}: {e}"),
            }
        }

        "bash" => {
            let command = input["command"].as_str().unwrap_or("");

            // Permission check
            if !policy.is_allowed("bash", command) {
                if let Some(risk) = risk_level(command) {
                    let perm_id = format!("perm-{}", uuid_v4());
                    let path_hint = command.split_whitespace()
                        .nth(1).unwrap_or("").to_string();

                    let _ = app.emit("agent-event", &AgentEvent::Permission {
                        id:     perm_id.clone(),
                        tool:   "SHELL".into(),
                        path:   path_hint,
                        detail: command.to_string(),
                        risk:   risk.to_string(),
                    });

                    let (tx, rx) = oneshot::channel::<PermResp>();
                    state.perm_map.lock().unwrap().insert(perm_id.clone(), tx);

                    match rx.await {
                        Ok(resp) if resp.allow => { /* fall through to execution */ }
                        _ => return "Operation denied by user.".to_string(),
                    }
                }
            }

            // Execute
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .current_dir(project_path)
                .output();

            match output {
                Ok(o) => {
                    let stdout = String::from_utf8_lossy(&o.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                    if o.status.success() {
                        if stdout.is_empty() { "Done (no output)".to_string() }
                        else { stdout.chars().take(4000).collect() }
                    } else {
                        format!("Exit {}: {stderr}", o.status.code().unwrap_or(-1))
                    }
                }
                Err(e) => format!("Failed to run command: {e}"),
            }
        }

        "glob" => {
            let pattern = input["pattern"].as_str().unwrap_or("**/*");
            run_shell(&format!("find . -name '{pattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100"), project_path)
        }

        "grep" => {
            let pat  = input["pattern"].as_str().unwrap_or("");
            let path = input["path"].as_str().unwrap_or(".");
            run_shell(&format!("grep -r --include='*' -n '{}' '{}' | head -100", pat.replace('\'', "\\'"), path), project_path)
        }

        "list_directory" => {
            let path = input["path"].as_str().unwrap_or(".");
            run_shell(&format!("ls -la '{}'", path.replace('\'', "\\'")), project_path)
        }

        _ => format!("Unknown tool: {tool_name}"),
    }
}

fn run_shell(cmd: &str, cwd: &str) -> String {
    match std::process::Command::new("sh").arg("-c").arg(cmd).current_dir(cwd).output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).to_string();
            let err = String::from_utf8_lossy(&o.stderr).to_string();
            if out.is_empty() && !err.is_empty() { err } else { out }
        }
        Err(e) => format!("shell error: {e}"),
    }
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let pid = std::process::id();
    format!("{nanos:08x}-{pid:08x}")
}

// ── Tool definitions for the API ──────────────────────────────────────────────

fn tools_json() -> Value {
    json!([
        {
            "name": "read_file",
            "description": "Read the full contents of a file.",
            "input_schema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Path relative to project root" } },
                "required": ["path"]
            }
        },
        {
            "name": "write_file",
            "description": "Write (or overwrite) a file with the given content.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path":    { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"]
            }
        },
        {
            "name": "edit_file",
            "description": "Replace the first occurrence of old_string with new_string in a file.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path":       { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" }
                },
                "required": ["path", "old_string", "new_string"]
            }
        },
        {
            "name": "bash",
            "description": "Run a shell command in the project directory. Destructive commands (rm, git reset --hard, etc.) require user permission.",
            "input_schema": {
                "type": "object",
                "properties": { "command": { "type": "string" } },
                "required": ["command"]
            }
        },
        {
            "name": "glob",
            "description": "List files matching a glob pattern.",
            "input_schema": {
                "type": "object",
                "properties": { "pattern": { "type": "string", "description": "Shell glob e.g. '*.ts' or 'src/**'" } },
                "required": ["pattern"]
            }
        },
        {
            "name": "grep",
            "description": "Search for a regex pattern in files.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path":    { "type": "string", "description": "Directory or file to search (default: project root)" }
                },
                "required": ["pattern"]
            }
        },
        {
            "name": "list_directory",
            "description": "List the contents of a directory.",
            "input_schema": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"]
            }
        }
    ])
}

// ── SSE parsing and agent loop ────────────────────────────────────────────────

struct Block {
    index: usize,
    kind: String,
    id: String,
    name: String,
    text: String,
}

async fn run_agent(
    app: AppHandle,
    state: AgentState,
    project_path: String,
    prompt: String,
    api_key: String,
) {
    let policy = load_policy_from_disk(&project_path);

    let client = reqwest::Client::new();
    let mut messages: Vec<Value> = vec![
        json!({ "role": "user", "content": prompt })
    ];

    const SYSTEM: &str = "You are Claude, an expert software engineering assistant embedded in Claude Workbench. \
        You help users with coding tasks on their local projects.\n\n\
        When given a task:\n\
        1. Start by reading relevant files to understand the codebase\n\
        2. If the task is complex, present a numbered plan before executing\n\
        3. Execute the plan step by step, running tests when available\n\
        4. Always use targeted edits rather than full rewrites when possible\n\n\
        The project root is your working directory for all file paths.";

    loop {
        let body = json!({
            "model": "claude-sonnet-4-6",
            "max_tokens": 8192,
            "system": SYSTEM,
            "tools": tools_json(),
            "stream": true,
            "messages": messages,
        });

        let resp = match client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit("agent-event", &AgentEvent::Error { message: e.to_string() });
                return;
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            let _ = app.emit("agent-event", &AgentEvent::Error {
                message: format!("API error {status}: {body_text}")
            });
            return;
        }

        // ── Parse SSE stream ──────────────────────────────────────────────────
        let mut blocks: Vec<Block> = Vec::new();
        let mut stop_reason = String::new();
        let mut buf = String::new();
        let mut plan_emitted = false;
        let mut first_text = true;

        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(_) => break,
            };
            buf.push_str(&String::from_utf8_lossy(&chunk));

            // Process complete SSE events (double-newline separated)
            loop {
                if let Some(pos) = buf.find("\n\n") {
                    let event_str = buf[..pos].to_string();
                    buf = buf[pos + 2..].to_string();

                    for line in event_str.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" { break; }
                            let ev: Value = match serde_json::from_str(data) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };

                            match ev["type"].as_str().unwrap_or("") {
                                "content_block_start" => {
                                    let idx  = ev["index"].as_u64().unwrap_or(0) as usize;
                                    let cb   = &ev["content_block"];
                                    let kind = cb["type"].as_str().unwrap_or("").to_string();
                                    let id   = cb["id"].as_str().unwrap_or("").to_string();
                                    let name = cb["name"].as_str().unwrap_or("").to_string();

                                    while blocks.len() <= idx {
                                        let next_idx = blocks.len();
                                        blocks.push(Block {
                                            index: next_idx,
                                            kind: String::new(),
                                            id: String::new(),
                                            name: String::new(),
                                            text: String::new(),
                                        });
                                    }
                                    blocks[idx].index = idx;
                                    blocks[idx].kind  = kind;
                                    blocks[idx].id    = id;
                                    blocks[idx].name  = name;
                                    blocks[idx].text  = String::new();
                                }

                                "content_block_delta" => {
                                    let idx   = ev["index"].as_u64().unwrap_or(0) as usize;
                                    let delta = &ev["delta"];
                                    match delta["type"].as_str().unwrap_or("") {
                                        "text_delta" => {
                                            let text = delta["text"].as_str().unwrap_or("");
                                            if idx < blocks.len() {
                                                blocks[idx].text.push_str(text);
                                            }
                                            let _ = app.emit("agent-event", &AgentEvent::Token { content: text.to_string() });
                                        }
                                        "input_json_delta" => {
                                            let partial = delta["partial_json"].as_str().unwrap_or("");
                                            if idx < blocks.len() {
                                                blocks[idx].text.push_str(partial);
                                            }
                                        }
                                        _ => {}
                                    }
                                }

                                "content_block_stop" => {
                                    let idx = ev["index"].as_u64().unwrap_or(0) as usize;
                                    if idx < blocks.len() {
                                        let block = &blocks[idx];
                                        if block.kind == "text" && first_text {
                                            first_text = false;
                                            let items = extract_plan(&block.text);
                                            if !items.is_empty() && !plan_emitted {
                                                let _ = app.emit("agent-event", &AgentEvent::Plan { items });
                                                plan_emitted = true;
                                            }
                                        }
                                        if block.kind == "tool_use" {
                                            let input: Value = serde_json::from_str(&block.text).unwrap_or(json!({}));
                                            let display = tool_display_name(&block.name);
                                            let path    = tool_path(&block.name, &input);
                                            let detail  = tool_detail(&block.name, &input);
                                            let _ = app.emit("agent-event", &AgentEvent::Tool {
                                                id:     block.id.clone(),
                                                tool:   display.to_string(),
                                                path,
                                                detail,
                                                status: "running".into(),
                                            });
                                        }
                                    }
                                }

                                "message_delta" => {
                                    if let Some(sr) = ev["delta"]["stop_reason"].as_str() {
                                        stop_reason = sr.to_string();
                                    }
                                }

                                _ => {}
                            }
                        }
                    }
                } else {
                    break;
                }
            }
        }

        // Build assistant message from accumulated blocks
        let content_arr: Vec<Value> = blocks.iter().map(|b| {
            if b.kind == "text" {
                json!({ "type": "text", "text": b.text })
            } else {
                let input: Value = serde_json::from_str(&b.text).unwrap_or(json!({}));
                json!({ "type": "tool_use", "id": b.id, "name": b.name, "input": input })
            }
        }).collect();
        messages.push(json!({ "role": "assistant", "content": content_arr }));

        if stop_reason != "tool_use" {
            break;
        }

        // Execute tools and collect results
        let mut tool_results: Vec<Value> = Vec::new();
        for block in &blocks {
            if block.kind == "tool_use" {
                let input: Value = serde_json::from_str(&block.text).unwrap_or(json!({}));
                let result = exec_tool(&app, &state, &policy, &project_path, &block.id, &block.name, &input).await;

                let _ = app.emit("agent-event", &AgentEvent::Tool {
                    id:     block.id.clone(),
                    tool:   tool_display_name(&block.name).to_string(),
                    path:   tool_path(&block.name, &input),
                    detail: tool_detail(&block.name, &input),
                    status: "done".into(),
                });

                tool_results.push(json!({
                    "type":        "tool_result",
                    "tool_use_id": block.id,
                    "content":     result,
                }));
            }
        }

        messages.push(json!({ "role": "user", "content": tool_results }));
    }

    // ── Post-run: emit git diff ───────────────────────────────────────────────
    if let Ok(diff_out) = std::process::Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&project_path)
        .output()
    {
        let patch = String::from_utf8_lossy(&diff_out.stdout).to_string();
        if !patch.trim().is_empty() {
            let _ = app.emit("agent-event", &AgentEvent::Diff { patch });
        }
    }

    let _ = app.emit("agent-event", &AgentEvent::Done);
}

fn extract_plan(text: &str) -> Vec<PlanItem> {
    let mut items = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        // Find where the leading digits end
        let digits_end = t.find(|c: char| !c.is_ascii_digit()).unwrap_or(0);
        if digits_end == 0 { continue; }
        let rest = &t[digits_end..];
        // Must be followed by '.' or ')'
        let label = if let Some(l) = rest.strip_prefix('.') {
            l
        } else if let Some(l) = rest.strip_prefix(')') {
            l
        } else {
            continue;
        };
        let label = label.trim().to_string();
        if !label.is_empty() {
            let n = items.len() + 1;
            items.push(PlanItem {
                id:     n.to_string(),
                label,
                status: if n == 1 { "active".into() } else { "pending".into() },
            });
        }
    }
    items
}

// ── Policy helpers ────────────────────────────────────────────────────────────

fn policy_path(project_path: &str) -> std::path::PathBuf {
    Path::new(project_path).join(".workbench").join("policy.toml")
}

fn load_policy_from_disk(project_path: &str) -> Policy {
    let path = policy_path(project_path);
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut policy = Policy::default();
    let mut current_tool = String::new();
    let mut current_pattern = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line == "[[allow]]" {
            if !current_tool.is_empty() && !current_pattern.is_empty() {
                policy.allow.push(PolicyEntry { tool: current_tool.clone(), pattern: current_pattern.clone() });
            }
            current_tool.clear();
            current_pattern.clear();
        } else if let Some(v) = line.strip_prefix("tool = ") {
            current_tool = v.trim_matches('"').to_string();
        } else if let Some(v) = line.strip_prefix("pattern = ") {
            current_pattern = v.trim_matches('"').to_string();
        }
    }
    if !current_tool.is_empty() && !current_pattern.is_empty() {
        policy.allow.push(PolicyEntry { tool: current_tool, pattern: current_pattern });
    }
    policy
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_task(
    app: AppHandle,
    state: State<'_, AgentState>,
    project_path: String,
    prompt: String,
    api_key: String,
) -> Result<(), String> {
    let app2    = app.clone();
    let state2  = state.perm_map.clone();
    let agent_state = AgentState { perm_map: state2 };
    tokio::spawn(async move {
        run_agent(app2, agent_state, project_path, prompt, api_key).await;
    });
    Ok(())
}

#[tauri::command]
async fn resolve_permission(
    state: State<'_, AgentState>,
    id: String,
    allow: bool,
    always: bool,
) -> Result<(), String> {
    let tx = state.perm_map.lock().unwrap().remove(&id);
    if let Some(tx) = tx {
        let _ = tx.send(PermResp { allow, always });
    }
    Ok(())
}

#[tauri::command]
async fn save_policy(project_path: String, tool: String, pattern: String) -> Result<(), String> {
    let path = policy_path(&project_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let entry = format!("\n[[allow]]\ntool = \"{}\"\npattern = \"{}\"\n", tool, pattern);
    let mut file = std::fs::OpenOptions::new()
        .create(true).append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(entry.as_bytes()).map_err(|e| e.to_string())?;
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

// ── App entry point ───────────────────────────────────────────────────────────

pub fn run() {
    let perm_map: PermMap = Arc::new(Mutex::new(HashMap::new()));
    let agent_state = AgentState { perm_map };

    tauri::Builder::default()
        .manage(agent_state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            start_task,
            resolve_permission,
            save_policy,
            save_profile,
            save_appearance,
            load_profile,
            choose_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
