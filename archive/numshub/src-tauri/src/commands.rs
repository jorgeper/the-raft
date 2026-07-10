//! Tauri commands — the IPC surface consumed by the frontend (and mirrored by
//! the browser mock shim for E2E tests).

use crate::registry::ModelEntry;
use crate::settings::Settings;
use crate::state::AppState;
use crate::{downloader, tray};
use serde::Serialize;
use tauri::{AppHandle, State};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
pub struct ModelStatus {
    #[serde(flatten)]
    pub entry: ModelEntry,
    pub downloaded: bool,
    pub downloading: bool,
    pub partial_bytes: u64,
    pub active: bool,
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub can_paste: bool,
    pub capture_ready: bool,
    pub platform: String,
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.read().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    state: State<AppState>,
    mut settings: Settings,
) -> CmdResult<()> {
    crate::settings::validate_enhancement_endpoint(&settings.enhancement.endpoint).map_err(err)?;
    crate::hotkey::validate_binding(&settings.hotkey).map_err(err)?;

    let (old_hotkey, old_autostart) = {
        let current = state.settings.read().unwrap();
        settings.preserve_server_owned(&current);
        (current.hotkey.clone(), current.launch_at_login)
    };

    // Apply side effects before persisting.
    if settings.hotkey != old_hotkey {
        if let Some(service) = state.hotkeys.lock().unwrap().as_ref() {
            service.set_main_binding(settings.hotkey.clone()).map_err(err)?;
        }
    }
    if settings.launch_at_login != old_autostart {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let result = if settings.launch_at_login {
            manager.enable()
        } else {
            manager.disable()
        };
        if let Err(e) = result {
            log::warn!("autostart change failed: {e}");
        }
    }

    {
        let mut current = state.settings.write().unwrap();
        *current = settings;
        current.save(&state.settings_path()).map_err(err)?;
    }
    tray::refresh_menu(&app, tray::TrayState::Idle);
    Ok(())
}

#[tauri::command]
pub fn list_models(state: State<AppState>) -> Vec<ModelStatus> {
    let active = state.settings.read().unwrap().active_model.clone();
    state
        .registry
        .list()
        .iter()
        .map(|entry| ModelStatus {
            downloaded: entry.is_downloaded(&state.data_dir),
            downloading: state.downloads.is_downloading(&entry.id),
            partial_bytes: downloader::partial_size(entry, &state.data_dir),
            active: active.as_deref() == Some(entry.id.as_str()),
            entry: entry.clone(),
        })
        .collect()
}

struct TauriSink(AppHandle);
impl downloader::EventSink for TauriSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        use tauri::Emitter;
        let _ = self.0.emit(event, payload);
    }
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> CmdResult<()> {
    let entry = state
        .registry
        .get(&model_id)
        .ok_or_else(|| format!("unknown model '{model_id}'"))?
        .clone();
    let cancel = state.downloads.begin(&model_id).map_err(err)?;
    let data_dir = state.data_dir.clone();
    let sink = TauriSink(app.clone());
    let result = downloader::download_model(&entry, &data_dir, &sink, cancel).await;
    state.downloads.finish(&model_id);
    result.map_err(err)
}

#[tauri::command]
pub fn cancel_download(state: State<AppState>, model_id: String) -> bool {
    state.downloads.cancel(&model_id)
}

#[tauri::command]
pub fn delete_model(app: AppHandle, state: State<AppState>, model_id: String) -> CmdResult<()> {
    let entry = state
        .registry
        .get(&model_id)
        .ok_or_else(|| format!("unknown model '{model_id}'"))?;
    downloader::delete_model(entry, &state.data_dir).map_err(err)?;
    {
        let mut settings = state.settings.write().unwrap();
        if settings.active_model.as_deref() == Some(model_id.as_str()) {
            settings.active_model = None;
            let _ = settings.save(&state.settings_path());
        }
    }
    state.unload_engine();
    use tauri::Emitter;
    let _ = app.emit(downloader::events::DELETED, &model_id);
    Ok(())
}

#[tauri::command]
pub fn set_active_model(state: State<AppState>, model_id: String) -> CmdResult<()> {
    let entry = state
        .registry
        .get(&model_id)
        .ok_or_else(|| format!("unknown model '{model_id}'"))?;
    if !entry.is_downloaded(&state.data_dir) {
        return Err(format!("model '{model_id}' is not downloaded"));
    }
    {
        let mut settings = state.settings.write().unwrap();
        settings.active_model = Some(model_id);
        settings.save(&state.settings_path()).map_err(err)?;
    }
    state.unload_engine(); // next dictation loads the new model warm
    Ok(())
}

#[tauri::command]
pub fn get_history(state: State<AppState>) -> Vec<crate::history::HistoryEntry> {
    state.history.lock().unwrap().list().cloned().collect()
}

#[tauri::command]
pub fn clear_history(app: AppHandle, state: State<AppState>) -> CmdResult<()> {
    {
        let mut history = state.history.lock().unwrap();
        history.clear();
        history.save(&state.history_path()).map_err(err)?;
    }
    let audio = crate::history::last_audio_path(&state.data_dir);
    if audio.exists() {
        std::fs::remove_file(audio).map_err(err)?;
    }
    use tauri::Emitter;
    let _ = app.emit("history-changed", ());
    tray::refresh_menu(&app, tray::TrayState::Idle);
    Ok(())
}

#[tauri::command]
pub fn copy_text(text: String) -> CmdResult<()> {
    crate::paste::copy_to_clipboard(&text).map_err(err)
}

#[tauri::command]
pub fn retry_last_transcription(state: State<AppState>) {
    state.pipeline.retry();
}

#[tauri::command]
pub fn toggle_dictation(state: State<AppState>) {
    state.pipeline.toggle();
}

#[tauri::command]
pub async fn test_enhancement(state: State<'_, AppState>, sample: String) -> CmdResult<String> {
    let cfg = state.settings.read().unwrap().enhancement.clone();
    let sample = if sample.trim().is_empty() {
        "so um i think we should uh probably ship it on on tuesday no wait wednesday".to_string()
    } else {
        sample
    };
    crate::enhance::enhance(&sample, &cfg).await.map_err(err)
}

#[tauri::command]
pub fn list_input_devices() -> Vec<String> {
    crate::audio::list_input_devices()
}

#[tauri::command]
pub fn start_hotkey_capture(app: AppHandle, state: State<AppState>) -> CmdResult<()> {
    let hotkeys = state.hotkeys.lock().unwrap();
    match hotkeys.as_ref() {
        Some(service) => {
            service.start_capture(app.clone());
            Ok(())
        }
        None => Err("keyboard capture is not initialized (grant Accessibility first)".into()),
    }
}

#[tauri::command]
pub fn stop_hotkey_capture(state: State<AppState>) {
    if let Some(service) = state.hotkeys.lock().unwrap().as_ref() {
        service.stop_capture();
    }
}

/// Initialize global hotkeys + paste after permissions are confirmed
/// (frontend calls this post-onboarding; idempotent).
#[tauri::command]
pub fn initialize_capture(app: AppHandle, state: State<AppState>) -> CmdResult<bool> {
    crate::init_capture(&app).map_err(err)?;
    Ok(state.hotkeys.lock().unwrap().is_some())
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        can_paste: state.paster.lock().unwrap().can_paste(),
        capture_ready: state.hotkeys.lock().unwrap().is_some(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
pub fn open_settings(app: AppHandle, section: Option<String>) {
    crate::show_settings_window(&app, section.as_deref());
}

/// SPEC2 FR-O2c: ground truth for "the menu-bar icon is actually visible".
#[tauri::command]
pub fn tray_item_visible() -> bool {
    crate::tray_probe::tray_item_visible()
}

#[tauri::command]
pub fn open_menu_bar_settings() {
    crate::tray_probe::open_menu_bar_settings();
}

#[tauri::command]
pub fn cancel_dictation(state: State<AppState>) {
    state.pipeline.cancel();
}

pub fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![
        get_settings,
        set_settings,
        list_models,
        download_model,
        cancel_download,
        delete_model,
        set_active_model,
        get_history,
        clear_history,
        copy_text,
        retry_last_transcription,
        toggle_dictation,
        cancel_dictation,
        test_enhancement,
        list_input_devices,
        start_hotkey_capture,
        stop_hotkey_capture,
        initialize_capture,
        get_app_info,
        open_settings,
        tray_item_visible,
        open_menu_bar_settings,
    ]
}
