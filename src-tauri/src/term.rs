// PTY terminal management.
//
// One Terminal per user-visible terminal tab. Each holds a portable-pty PtyPair,
// a writer handle, and a child handle. A reader thread per terminal pumps stdout
// into base64-encoded `term-output` events keyed by terminal id.

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// Maximum scrollback buffer size per terminal (512 KB).
const SCROLLBACK_CAP: usize = 512 * 1024;

pub struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    cwd: String,
    scrollback: Arc<Mutex<Vec<u8>>>,
}

#[derive(Default)]
pub struct TerminalState(pub Mutex<HashMap<String, Terminal>>);

#[derive(Serialize, Clone)]
pub struct TerminalInfo {
    pub id: String,
    pub cwd: String,
}

#[derive(Serialize, Clone)]
struct TermOutput {
    id: String,
    /// Base64-encoded raw bytes from the PTY. Base64 because the byte stream
    /// is not guaranteed to be valid UTF-8 at chunk boundaries.
    data: String,
}

#[derive(Serialize, Clone)]
struct TermExit {
    id: String,
    code: Option<i32>,
}

fn next_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("t-{nanos:x}")
}

fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "cmd.exe".into()
        } else if cfg!(target_os = "macos") {
            "/bin/zsh".into()
        } else {
            "/bin/bash".into()
        }
    })
}

#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<TerminalInfo, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(user_shell());
    cmd.cwd(&cwd);
    // Hint the shell that it is interactive
    if cfg!(unix) {
        cmd.env("TERM", std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".into()));
    }
    // Inherit the parent env (CommandBuilder defaults are sparse on macOS)
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let id = next_id();

    // Scrollback buffer shared between the Terminal struct and the reader thread.
    let scrollback: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

    // Reader thread → emits term-output{id, data}
    {
        let id = id.clone();
        let app = app.clone();
        let scrollback_ref = Arc::clone(&scrollback);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Append to scrollback, trim front if over cap.
                        if let Ok(mut sb) = scrollback_ref.lock() {
                            sb.extend_from_slice(&buf[..n]);
                            if sb.len() > SCROLLBACK_CAP {
                                let excess = sb.len() - SCROLLBACK_CAP;
                                sb.drain(0..excess);
                            }
                        }
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app.emit("term-output", TermOutput { id: id.clone(), data: encoded });
                    }
                    Err(_) => break,
                }
            }
            let _ = app.emit("term-exit", TermExit { id: id.clone(), code: None });
        });
    }

    let term = Terminal {
        master: pair.master,
        writer,
        child,
        cwd: cwd.clone(),
        scrollback,
    };

    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), term);

    Ok(TerminalInfo { id, cwd })
}

#[tauri::command]
pub async fn term_write(
    state: State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let term = map.get_mut(&id).ok_or_else(|| "unknown terminal".to_string())?;
    term.writer.write_all(&bytes).map_err(|e| e.to_string())?;
    term.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn term_resize(
    state: State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    let term = map.get(&id).ok_or_else(|| "unknown terminal".to_string())?;
    term.master
        .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn term_close(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut term) = map.remove(&id) {
        let _ = term.child.kill();
        let _ = term.child.wait();
        drop(term.writer);
        drop(term.master);
    }
    Ok(())
}

/// Kill all live PTYs. Call from the app exit hook.
pub fn shutdown_all_state(state: &TerminalState) {
    if let Ok(mut map) = state.0.lock() {
        for (_, mut term) in map.drain() {
            let _ = term.child.kill();
            let _ = term.child.wait();
        }
    }
}

#[tauri::command]
pub async fn term_list(state: State<'_, TerminalState>) -> Result<Vec<TerminalInfo>, String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    Ok(map
        .iter()
        .map(|(id, t)| TerminalInfo { id: id.clone(), cwd: t.cwd.clone() })
        .collect())
}

/// Return the accumulated scrollback for a terminal as a base64-encoded string.
/// The frontend can write this to an xterm instance on attach to replay history.
#[tauri::command]
pub async fn term_attach(state: State<'_, TerminalState>, id: String) -> Result<String, String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    let term = map.get(&id).ok_or_else(|| "unknown terminal".to_string())?;
    let sb = term.scrollback.lock().map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&*sb);
    Ok(encoded)
}
