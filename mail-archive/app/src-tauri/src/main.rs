// Prevents an extra console window on Windows release builds; harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod protocol;

use std::path::PathBuf;

use mail_core::library::Library;
use tauri::{Manager, RunEvent};

use commands::AppState;
use config::{Config, config_path};

fn main() {
    // Panic text from message parsing can quote mail; never print it.
    mail_core::import::scan::install_panic_hook();

    let cfg_path = config_path();
    // May fail (e.g. the library is open elsewhere); then we start unconfigured
    // and the UI shows first-run.
    let lib = Config::load_from(&cfg_path)
        .library_path
        .and_then(|p| Library::open(&p).ok());

    let session = format!("session-{}", std::process::id());
    let session_dir: std::sync::Arc<std::sync::Mutex<Option<PathBuf>>> = Default::default();
    let exit_dir = session_dir.clone();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let cache = app.path().app_cache_dir()?.join(&session);
            *session_dir.lock().unwrap() = Some(cache.clone());
            app.manage(AppState::new(lib, cfg_path, cache));
            Ok(())
        })
        .register_uri_scheme_protocol("mailbody", |ctx, req| {
            let state = ctx.app_handle().state::<AppState>();
            protocol::guarded(|| protocol::serve_body(&state, req.uri().path(), req.uri().query()))
        })
        .register_uri_scheme_protocol("mailcid", |ctx, req| {
            let state = ctx.app_handle().state::<AppState>();
            protocol::guarded(|| protocol::serve_cid(&state, req.uri().path()))
        })
        .invoke_handler(tauri::generate_handler![
            commands::search,
            commands::get_thread,
            commands::autocomplete,
            commands::open_attachment,
            commands::save_attachment,
            commands::open_link,
            commands::import_scan,
            commands::import_apply,
            commands::import_cancel,
            commands::rebuild_index,
            commands::library_status,
            commands::set_library_path,
        ])
        .build(tauri::generate_context!());

    match result {
        Ok(app) => app.run(move |_, event| {
            if let RunEvent::Exit = event
                && let Some(dir) = exit_dir.lock().ok().and_then(|g| g.clone())
            {
                let _ = std::fs::remove_dir_all(dir);
            }
        }),
        Err(_) => {
            eprintln!("mail-archive: failed to start the window");
            std::process::exit(1);
        }
    }
}
