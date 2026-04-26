mod db;
mod fs;
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(db::init_db().build())
        .plugin(tauri_plugin_notification::init())
        .manage(pty::PtyState::new())
        .manage(fs::FsWatcherState::new())
        .invoke_handler(tauri::generate_handler![
            pty::spawn_session,
            pty::send_input,
            pty::stop_session,
            pty::resize_session,
            pty::get_session_status,
            fs::list_directory,
            fs::read_file,
            fs::watch_directory,
            fs::unwatch_directory,
            pty::check_claude_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
