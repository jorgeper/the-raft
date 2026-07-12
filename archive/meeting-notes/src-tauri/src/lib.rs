pub mod audio;
pub mod commands;
pub mod diar;
pub mod document;
pub mod engine;
pub mod namer;
pub mod paths;
pub mod stt;
pub mod vad;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::pause,
            commands::resume,
            commands::stop,
            commands::save,
            commands::open,
            commands::add_image,
            commands::rename_speaker,
            commands::check_recovery,
            commands::recover,
            commands::discard_recovery,
            commands::new_conversation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
