use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

// ── Agent event types emitted to the frontend ────────────────────────────────

#[derive(Serialize, Clone)]
struct PlanEventItem {
    id: String,
    label: String,
    status: String, // "pending" | "active" | "done"
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AgentEvent {
    Token { content: String },
    Plan { items: Vec<PlanEventItem> },
    Tool {
        id: String,
        tool: String,
        path: String,
        detail: String,
        status: String,
    },
    Diff { patch: String },
    Done,
    Error { message: String },
}

// ── Claude stream-json line shapes ───────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct StreamLine {
    #[serde(rename = "type")]
    kind: String,
    // assistant message
    message: Option<AssistantMessage>,
    // tool_use
    id: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
    // tool_result
    tool_use_id: Option<String>,
    // result
    result: Option<serde_json::Value>,
    // subtype / error
    subtype: Option<String>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
struct AssistantMessage {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize, Debug)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    // for tool_use blocks inside assistant messages
    id: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
}

// ── Pending permission handles (step 5 stub) ─────────────────────────────────

type PermissionMap = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>;

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn save_profile(data: String) -> Result<(), String> {
    let home = dirs_next_home().ok_or("Cannot resolve home directory")?;
    let dir = home.join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("profile.json"), data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn save_appearance(data: String) -> Result<(), String> {
    let home = dirs_next_home().ok_or("Cannot resolve home directory")?;
    let dir = home.join(".workbench");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("appearance.json"), data).map_err(|e| e.to_string())?;
    Ok(())
}

fn dirs_next_home() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(std::path::PathBuf::from)
}

#[tauri::command]
async fn start_task(app: AppHandle, project_path: String, prompt: String) -> Result<(), String> {
    let app_clone = app.clone();
    let project_path_clone = project_path.clone();

    tokio::spawn(async move {
        run_agent(app_clone, project_path_clone, prompt).await;
    });

    Ok(())
}

async fn run_agent(app: AppHandle, project_path: String, prompt: String) {
    // ── Spawn the claude CLI ─────────────────────────────────────────────────
    let child = std::process::Command::new("claude")
        .args(["--output-format", "stream-json", "--print", &prompt])
        .current_dir(&project_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                "agent-event",
                &AgentEvent::Error {
                    message: format!("Failed to launch 'claude': {e}. Make sure the claude CLI is installed and on PATH."),
                },
            );
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = app.emit(
                "agent-event",
                &AgentEvent::Error {
                    message: "Could not capture claude stdout".into(),
                },
            );
            return;
        }
    };

    // ── Parse stream-json lines ──────────────────────────────────────────────
    let reader = BufReader::new(stdout);
    let mut first_assistant_text_done = false;
    let mut plan_emitted = false;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let parsed: StreamLine = match serde_json::from_str(&line) {
            Ok(p) => p,
            Err(_) => continue, // skip lines we can't parse
        };

        match parsed.kind.as_str() {
            "assistant" => {
                if let Some(msg) = parsed.message {
                    for block in &msg.content {
                        match block.kind.as_str() {
                            "text" => {
                                let text = block.text.clone().unwrap_or_default();
                                if text.is_empty() {
                                    continue;
                                }

                                // Before emitting tokens, check for a numbered plan list
                                if !plan_emitted && !first_assistant_text_done {
                                    let plan_items = extract_plan_items(&text);
                                    if !plan_items.is_empty() {
                                        let _ = app.emit(
                                            "agent-event",
                                            &AgentEvent::Plan { items: plan_items },
                                        );
                                        plan_emitted = true;
                                    }
                                    first_assistant_text_done = true;
                                }

                                // Stream text in ~100-char chunks
                                let mut offset = 0;
                                while offset < text.len() {
                                    let end = (offset + 100).min(text.len());
                                    // Ensure we don't split a multi-byte char
                                    let chunk = &text[offset..end];
                                    let _ = app.emit(
                                        "agent-event",
                                        &AgentEvent::Token {
                                            content: chunk.to_string(),
                                        },
                                    );
                                    offset = end;
                                }
                            }
                            "tool_use" => {
                                // Tool use blocks embedded inside an assistant message
                                let id = block.id.clone().unwrap_or_default();
                                let name = block.name.clone().unwrap_or_default();
                                let (tool_verb, path, detail) =
                                    tool_fields_from_name_and_input(&name, &block.input);
                                let _ = app.emit(
                                    "agent-event",
                                    &AgentEvent::Tool {
                                        id,
                                        tool: tool_verb,
                                        path,
                                        detail,
                                        status: "running".into(),
                                    },
                                );
                            }
                            _ => {}
                        }
                    }
                }
            }

            "tool_use" => {
                let id = parsed.id.clone().unwrap_or_default();
                let name = parsed.name.clone().unwrap_or_default();
                let (tool_verb, path, detail) =
                    tool_fields_from_name_and_input(&name, &parsed.input);
                let _ = app.emit(
                    "agent-event",
                    &AgentEvent::Tool {
                        id,
                        tool: tool_verb,
                        path,
                        detail,
                        status: "running".into(),
                    },
                );
            }

            "tool_result" => {
                let id = parsed.tool_use_id.clone().unwrap_or_default();
                let _ = app.emit(
                    "agent-event",
                    &AgentEvent::Tool {
                        id,
                        tool: String::new(),
                        path: String::new(),
                        detail: String::new(),
                        status: "done".into(),
                    },
                );
            }

            "result" => {
                // Check for error subtype
                if parsed.subtype.as_deref() == Some("error") {
                    let msg = parsed
                        .error
                        .as_ref()
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("Unknown error from claude")
                        .to_string();
                    let _ = app.emit("agent-event", &AgentEvent::Error { message: msg });
                    return;
                }
                // Normal completion — fall through to emit Done + Diff below
                break;
            }

            "system" => {
                // init / session info — ignore
            }

            _ => {
                // Unknown line type — ignore
            }
        }
    }

    // Wait for child to exit
    let status = child.wait();

    // Check exit status
    match status {
        Ok(s) if !s.success() => {
            let code = s.code().unwrap_or(-1);
            let _ = app.emit(
                "agent-event",
                &AgentEvent::Error {
                    message: format!("claude exited with code {code}"),
                },
            );
            return;
        }
        Err(e) => {
            let _ = app.emit(
                "agent-event",
                &AgentEvent::Error {
                    message: format!("Failed to wait for claude: {e}"),
                },
            );
            return;
        }
        _ => {}
    }

    // ── Run git diff HEAD after the agent finishes ────────────────────────────
    if let Ok(diff_output) = std::process::Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&project_path)
        .output()
    {
        let patch = String::from_utf8_lossy(&diff_output.stdout).to_string();
        if !patch.trim().is_empty() {
            let _ = app.emit("agent-event", &AgentEvent::Diff { patch });
        }
    }

    let _ = app.emit("agent-event", &AgentEvent::Done);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn tool_fields_from_name_and_input(
    name: &str,
    input: &Option<serde_json::Value>,
) -> (String, String, String) {
    let verb = match name {
        "read_file" | "Read" => "READ",
        "write_file" | "Write" => "WRITE",
        "bash" | "Bash" => "SHELL",
        "grep" | "Grep" => "GREP",
        "edit_file" | "Edit" => "EDIT",
        _ => "TOOL",
    }
    .to_string();

    let (path, detail) = if let Some(inp) = input {
        let path = inp
            .get("path")
            .or_else(|| inp.get("file_path"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let detail = if name == "bash" || name == "Bash" {
            inp.get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .chars()
                .take(60)
                .collect()
        } else if name == "grep" || name == "Grep" {
            inp.get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            String::new()
        };
        (path, detail)
    } else {
        (String::new(), String::new())
    };

    (verb, path, detail)
}

/// Look for numbered list items in the first assistant text message.
/// Lines like "1. Do this thing" are extracted as plan items.
fn extract_plan_items(text: &str) -> Vec<PlanEventItem> {
    let mut items = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        // Match "1." or "1)" at the start of a line
        if let Some(rest) = trimmed.strip_prefix(|c: char| c.is_ascii_digit()) {
            let rest = rest.trim_start_matches(|c: char| c.is_ascii_digit()); // multi-digit
            if let Some(label) = rest
                .strip_prefix('.')
                .or_else(|| rest.strip_prefix(')'))
            {
                let label = label.trim().to_string();
                if !label.is_empty() {
                    let status = if i == 0 { "active" } else { "pending" }.to_string();
                    items.push(PlanEventItem {
                        id: (items.len() + 1).to_string(),
                        label,
                        status,
                    });
                }
            }
        }
    }
    // First item active, rest pending
    if let Some(first) = items.first_mut() {
        first.status = "active".to_string();
    }
    items
}

// ── App entry point ──────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![start_task, save_profile, save_appearance])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
