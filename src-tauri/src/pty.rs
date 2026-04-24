use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum PtyEvent {
    Output { data: String },
    Exit { code: Option<u32> },
    Error { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Running,
    Stopped,
    Errored,
}

struct SessionHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    status: SessionStatus,
}

pub struct PtyState {
    sessions: HashMap<String, SessionHandle>,
}

impl PtyState {
    pub fn new() -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            sessions: HashMap::new(),
        }))
    }
}

pub type SharedPtyState = Arc<Mutex<PtyState>>;

#[tauri::command]
pub async fn spawn_session(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
    working_dir: String,
    on_event: Channel<PtyEvent>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(&working_dir);
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    // Critical: drop slave so reader gets EOF when process exits
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store session handle
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.sessions.insert(
            session_id.clone(),
            SessionHandle {
                writer,
                master: pair.master,
                status: SessionStatus::Running,
            },
        );
    }

    // Background reader thread — streams PTY output to frontend via Channel
    let output_channel = on_event.clone();
    let sid_for_reader = session_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = output_channel.send(PtyEvent::Output { data: text });
                }
                Err(e) => {
                    let _ = output_channel.send(PtyEvent::Error {
                        message: format!("Read error in session {}: {}", sid_for_reader, e),
                    });
                    break;
                }
            }
        }
    });

    // Clone the Arc for the exit-watcher thread
    let state_arc = state.inner().clone();
    let exit_channel = on_event;
    let sid_for_exit = session_id;
    tokio::task::spawn_blocking(move || {
        let status = child.wait();
        let code = status.ok().map(|s| s.exit_code());
        let _ = exit_channel.send(PtyEvent::Exit { code });

        if let Ok(mut s) = state_arc.lock() {
            if let Some(handle) = s.sessions.get_mut(&sid_for_exit) {
                handle.status = SessionStatus::Stopped;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn send_input(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let handle = s
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;

    handle
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn stop_session(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = s.sessions.remove(&session_id) {
        drop(handle.writer);
        drop(handle.master);
    }
    Ok(())
}

#[tauri::command]
pub fn resize_session(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let handle = s
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_session_status(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
) -> Result<Option<SessionStatus>, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s.sessions.get(&session_id).map(|h| h.status))
}
