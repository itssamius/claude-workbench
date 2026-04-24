mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::new())
        .invoke_handler(tauri::generate_handler![
            pty::spawn_session,
            pty::send_input,
            pty::stop_session,
            pty::resize_session,
            pty::get_session_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
