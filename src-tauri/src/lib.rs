mod db;
mod fs;
mod pty;
mod tokens;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(db::init_db().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(pty::PtyState::new())
        .manage(fs::FsWatcherState::new())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::spawn_session,
            pty::send_input,
            pty::stop_session,
            pty::resize_session,
            pty::get_session_status,
            pty::spawn_terminal,
            pty::send_terminal_input,
            pty::resize_terminal,
            pty::close_terminal,
            fs::list_directory,
            fs::read_file,
            fs::watch_directory,
            fs::unwatch_directory,
            fs::write_file,
            fs::get_changed_files,
            fs::get_file_snapshot,
            fs::remove_changed_file,
            tokens::parse_session_usage,
            pty::check_claude_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
