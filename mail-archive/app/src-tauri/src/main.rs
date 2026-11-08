// Prevents an extra console window on Windows release builds; harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
#[cfg(test)]
mod ipc_contract;
mod menu;
mod nav;
mod protocol;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Manager, RunEvent};

use commands::AppState;
use config::{Config, config_path};

/// Panic payloads can quote mail text, so the app never prints them: only
/// where the panic happened. (The CLI keeps core's own hook.)
fn install_app_panic_hook() {
    std::panic::set_hook(Box::new(|info| match info.location() {
        Some(l) => eprintln!("mail-archive: internal error at {}:{}", l.file(), l.line()),
        None => eprintln!("mail-archive: internal error"),
    }));
}

fn main() {
    install_app_panic_hook();

    let cfg_path = config_path();
    // Keep the reason if the configured library cannot be opened (e.g. it is
    // in use elsewhere), so the UI can show it instead of looking like first run.
    let (lib, open_error) = match Config::load_from(&cfg_path).library_path {
        Some(p) => commands::open_library(&p),
        None => (None, None),
    };

    let session = format!("session-{}", std::process::id());
    let session_dir: Arc<Mutex<Option<PathBuf>>> = Default::default();
    let exit_dir = session_dir.clone();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let base = app.path().app_cache_dir()?;
            commands::sweep_stale_sessions(&base, &session);
            let cache = base.join(&session);
            *session_dir.lock().unwrap() = Some(cache.clone());
            app.manage(AppState::new(lib, open_error, cfg_path, cache));

            // The main window is built here (config has `create: false`) so
            // it can carry the link-routing hooks. See nav.rs.
            let mut origins = vec!["tauri://localhost".to_string()];
            if tauri::is_dev()
                && let Some(dev) = &app.config().build.dev_url
            {
                origins.push(nav::origin_key(dev));
            }
            let origins_nav = origins.clone();
            let app_nav = app.handle().clone();
            let app_win = app.handle().clone();
            let cfg = app.config().app.windows[0].clone();
            WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .on_navigation(move |url| match nav::route_navigation(url, &origins_nav) {
                    nav::NavDecision::Allow => true,
                    nav::NavDecision::Deny => false,
                    nav::NavDecision::OpenExternal(u) => {
                        nav::open_external(app_nav.clone(), u);
                        false
                    }
                })
                .on_new_window(move |url, _features| {
                    // A window is never created: external links go to the browser.
                    if let nav::NavDecision::OpenExternal(u) = nav::route_navigation(&url, &origins) {
                        nav::open_external(app_win.clone(), u);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            app.set_menu(menu::build(app.handle())?)?;
            app.on_menu_event(|app, event| menu::handle(app, event.id().as_ref()));
            Ok(())
        })
        // The handlers run on the blocking pool, never on the main thread.
        .register_asynchronous_uri_scheme_protocol("mailbody", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::guarded(|| {
                    let state = app.state::<AppState>();
                    protocol::serve_body(&state, req.uri().path(), req.uri().query())
                }));
            });
        })
        .register_asynchronous_uri_scheme_protocol("mailcid", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::guarded(|| {
                    let state = app.state::<AppState>();
                    protocol::serve_cid(&state, req.uri().path())
                }));
            });
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
            commands::reveal_library,
            commands::reopen_library,
            commands::import_discard,
            commands::check_library_folder,
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
