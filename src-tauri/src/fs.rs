use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub path: String,
    pub session_id: String,
}

type WatcherHandle = notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>;

pub struct FsWatcherState {
    watchers: HashMap<String, WatcherHandle>,
}

impl FsWatcherState {
    pub fn new() -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            watchers: HashMap::new(),
        }))
    }
}

pub type SharedFsWatcherState = Arc<Mutex<FsWatcherState>>;

const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    "__pycache__",
    ".cache",
    ".claude",
];

fn should_ignore(name: &str) -> bool {
    name.starts_with('.') && IGNORED_DIRS.contains(&name) || IGNORED_DIRS.contains(&name)
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut entries: Vec<FileEntry> = Vec::new();
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if should_ignore(&name) {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn watch_directory(
    app: AppHandle,
    state: tauri::State<'_, SharedFsWatcherState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;

    // Stop existing watcher for this session
    s.watchers.remove(&session_id);

    let sid = session_id.clone();
    let app_handle = app.clone();

    let debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<DebouncedEvent>, notify::Error>| {
            if let Ok(events) = result {
                for event in events {
                    let file_path = event.path.to_string_lossy().to_string();
                    let _ = app_handle.emit(
                        "file-changed",
                        FileChangeEvent {
                            path: file_path,
                            session_id: sid.clone(),
                        },
                    );
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let watch_path = PathBuf::from(&path);
    let mut debouncer = debouncer;
    debouncer
        .watcher()
        .watch(&watch_path, notify::RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    s.watchers.insert(session_id, debouncer);
    Ok(())
}

#[tauri::command]
pub fn unwatch_directory(
    state: tauri::State<'_, SharedFsWatcherState>,
    session_id: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.watchers.remove(&session_id);
    Ok(())
}
