//! Numshub — fast, fully-local voice dictation (SPEC.md).

pub mod audio;
pub mod cleanup;
pub mod commands;
pub mod downloader;
pub mod enhance;
pub mod history;
pub mod hotkey;
pub mod overlay;
pub mod paste;
pub mod pipeline;
pub mod registry;
pub mod settings;
pub mod state;
pub mod stt;
pub mod tray;

use state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS_LABEL: &str = "settings";

/// Show (creating if needed) the settings window, optionally deep-linking to a
/// section ("models" for the no-model flow).
pub fn show_settings_window(app: &AppHandle, section: Option<&str>) {
    use tauri::Emitter;
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(section) = section {
        let _ = app.emit_to(SETTINGS_LABEL, "navigate-section", section);
    }
}

fn create_settings_window(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title("Numshub")
        .inner_size(780.0, 560.0)
        .min_inner_size(680.0, 480.0)
        .visible(visible)
        .build()?;
    Ok(())
}

/// Initialize global hotkeys + paste. On macOS this fails (returning Ok with
/// hotkeys unset) until Accessibility is granted; the frontend retries via the
/// initialize_capture command after onboarding. Idempotent.
pub fn init_capture(app: &AppHandle) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    {
        let mut paster = state.paster.lock().unwrap();
        paster.reinit();
    }
    let mut hotkeys = state.hotkeys.lock().unwrap();
    if hotkeys.is_some() {
        return Ok(());
    }
    let binding = state.settings.read().unwrap().hotkey.clone();
    match hotkey::HotkeyService::start(app.clone(), binding) {
        Ok(service) => {
            *hotkeys = Some(service);
            log::info!("global hotkey service started");
            use tauri::Emitter;
            let _ = app.emit("capture-ready", true);
            Ok(())
        }
        Err(e) => {
            // The permission watcher retries every few seconds; only the
            // first failure is worth a warning.
            static WARNED: std::sync::Once = std::sync::Once::new();
            let msg = e.to_string();
            WARNED.call_once(|| log::warn!("hotkey service unavailable (permissions?): {msg}"));
            log::debug!("hotkey service unavailable: {msg}");
            Ok(())
        }
    }
}

/// macOS: Accessibility can be granted while the app is running (System
/// Settings toggle). Nothing notifies us, so poll until capture starts —
/// otherwise the hotkey silently does nothing until the next relaunch.
fn spawn_capture_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("capture-watcher".into())
        .spawn(move || loop {
            {
                let state = app.state::<AppState>();
                if state.hotkeys.lock().unwrap().is_some() {
                    log::debug!("capture watcher done: hotkey service running");
                    return;
                }
            }
            let _ = init_capture(&app);
            std::thread::sleep(std::time::Duration::from_secs(3));
        })
        .expect("spawn capture watcher");
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .plugin(tauri_nspanel::init())
            .plugin(tauri_plugin_macos_permissions::init());
    }

    builder
        .invoke_handler(commands::handlers())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("resolving app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let settings = settings::Settings::load(&data_dir.join("settings.json"));
            let registry = registry::Registry::embedded().expect("embedded registry is valid");
            let history = history::HistoryStore::load(&data_dir.join("history.json"));
            let onboarding_needed = !settings.onboarding_complete;

            // Level callback: mic levels -> overlay waveform (~30 Hz).
            let level_handle = handle.clone();
            let recorder = audio::AudioRecorder::new(Arc::new(move |level: f32| {
                overlay::emit_level(&level_handle, level);
            }));

            let pipeline = pipeline::Pipeline::start(handle.clone());
            app.manage(AppState::new(
                data_dir, settings, registry, history, recorder, pipeline,
            ));

            overlay::create(&handle)?;
            create_settings_window(&handle, onboarding_needed)?;
            tray::create(&handle)?;

            // Start capture now if permissions already allow it (non-mac, or
            // Accessibility granted in a previous run); on macOS keep watching
            // so a mid-session grant activates the hotkey without a relaunch.
            let _ = init_capture(&handle);
            #[cfg(target_os = "macos")]
            spawn_capture_watcher(handle.clone());

            // Headless perf probe (ARCHITECTURE.md §7 numbers): show the
            // overlay, stream synthetic levels, report RSS, exit.
            if std::env::var("NUMSHUB_PERF_PROBE").is_ok() {
                let handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let t0 = std::time::Instant::now();
                    overlay::show_state(&handle, overlay::state::RECORDING);
                    log::info!("PERF overlay show_state->visible: {:?}", t0.elapsed());
                    for i in 0..45u32 {
                        overlay::emit_level(&handle, (i % 10) as f32 / 10.0);
                        std::thread::sleep(std::time::Duration::from_millis(33));
                    }
                    overlay::hide(&handle);
                    let rss_kb = std::process::Command::new("ps")
                        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                        .output()
                        .ok()
                        .and_then(|o| String::from_utf8(o.stdout).ok())
                        .and_then(|s| s.trim().parse::<u64>().ok())
                        .unwrap_or(0);
                    log::info!("PERF idle rss: {} MB", rss_kb / 1024);
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    handle.exit(0);
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Settings window closes hide it — the app lives in the menu bar.
            if window.label() == SETTINGS_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running numshub");
}
