//! Tauri commands and the engine→webview event bridge.

use crate::audio::{AudioSource, MicSource, WavFileSource};
use crate::document::{read_mnote_full, write_mnote, Conversation, Item};
use crate::engine::{Engine, EngineEvent};
use anyhow::Result;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const DEFAULT_MODEL: &str = "small";
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic"];

#[derive(Default)]
pub struct Inner {
    pub engine: Option<Engine>,
    pub conversation: Option<Conversation>,
    pub audio_ogg: Option<Vec<u8>>,
    /// Dropped images awaiting save: (asset file name, absolute source path).
    pub staged_images: Vec<(String, PathBuf)>,
}

#[derive(Default)]
pub struct AppState(pub Mutex<Inner>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn encode_ogg(samples_16k: &[f32]) -> Result<Vec<u8>> {
    let pcm: Vec<i16> = samples_16k
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();
    Ok(ogg_opus::encode::<16000, 1>(&pcm)?)
}

fn make_source() -> Box<dyn AudioSource> {
    // e2e hook: point MINUTES_FAKE_MIC at a 16k mono wav to record from a file.
    match std::env::var("MINUTES_FAKE_MIC") {
        Ok(path) if !path.is_empty() => Box::new(WavFileSource::new(path, true)),
        _ => Box::new(MicSource::new()),
    }
}

#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut inner = state.0.lock().unwrap();
    if inner.engine.is_some() {
        return Err("already recording".into());
    }
    let (tx, rx) = crossbeam_channel::unbounded::<EngineEvent>();
    let engine = Engine::start(make_source(), DEFAULT_MODEL, tx).map_err(err)?;

    // Bridge engine events to webview events. Thread exits when the engine
    // drops its sender (on stop).
    std::thread::spawn(move || {
        for ev in rx {
            let channel = match &ev {
                EngineEvent::Partial { .. } => "timeline/partial",
                EngineEvent::Final(_) => "timeline/final",
                EngineEvent::Level { .. } => "audio/level",
                EngineEvent::Status { .. } => "engine/status",
                EngineEvent::SpeakerUpdated(_) => "timeline/speaker-updated",
            };
            let _ = app.emit(channel, &ev);
        }
    });

    inner.engine = Some(engine);
    inner.conversation = None;
    inner.audio_ogg = None;
    inner.staged_images.clear();
    Ok(())
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<(), String> {
    let inner = state.0.lock().unwrap();
    inner.engine.as_ref().ok_or("not recording")?.pause();
    Ok(())
}

#[tauri::command]
pub fn resume(state: State<'_, AppState>) -> Result<(), String> {
    let inner = state.0.lock().unwrap();
    inner.engine.as_ref().ok_or("not recording")?.resume();
    Ok(())
}

#[tauri::command]
pub fn stop(state: State<'_, AppState>) -> Result<Conversation, String> {
    let engine = {
        let mut inner = state.0.lock().unwrap();
        inner.engine.take().ok_or("not recording")?
    };
    // stop() blocks while whisper drains — don't hold the state lock meanwhile.
    let (conv, audio) = engine.stop().map_err(err)?;
    let ogg = encode_ogg(&audio).map_err(err)?;
    let mut inner = state.0.lock().unwrap();
    inner.conversation = Some(conv.clone());
    inner.audio_ogg = Some(ogg);
    Ok(conv)
}

#[tauri::command]
pub fn save(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let inner = state.0.lock().unwrap();
    let conv = inner.conversation.as_ref().ok_or("nothing to save")?;
    let mut path = PathBuf::from(path);
    if path.extension().map(|e| e != "mnote").unwrap_or(true) {
        path.set_extension("mnote");
    }
    let mut assets = Vec::new();
    for (name, src) in &inner.staged_images {
        let bytes = std::fs::read(src)
            .map_err(|e| format!("reading dropped image {}: {e}", src.display()))?;
        assets.push((name.clone(), bytes));
    }
    let audio = if get_settings().keep_audio { inner.audio_ogg.as_deref() } else { None };
    write_mnote(&path, conv, audio, &assets).map_err(err)?;
    crate::paths::clear_recovery(); // the meeting is durably on disk now
    Ok(())
}

#[derive(Serialize)]
pub struct OpenResult {
    pub conversation: Conversation,
    /// Directory the bundled assets were extracted to (for display).
    pub asset_dir: String,
}

#[tauri::command]
pub fn open(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<OpenResult, String> {
    let (conv, assets, audio) = read_mnote_full(&PathBuf::from(path)).map_err(err)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(err)?
        .join("opened")
        .join(&conv.id);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let mut inner = state.0.lock().unwrap();
    inner.staged_images.clear();
    for (name, bytes) in &assets {
        let p = dir.join(name);
        std::fs::write(&p, bytes).map_err(err)?;
        inner.staged_images.push((name.clone(), p));
    }
    inner.conversation = Some(conv.clone());
    inner.audio_ogg = audio; // re-saving keeps the original audio
    Ok(OpenResult { conversation: conv, asset_dir: dir.to_string_lossy().into_owned() })
}

#[tauri::command]
pub fn add_image(
    path: String,
    after_item_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Item, String> {
    let src = PathBuf::from(&path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(format!("not an image: .{ext}"));
    }
    let mut inner = state.0.lock().unwrap();
    let file_name = format!("img-{:04}.{ext}", inner.staged_images.len() + 1);

    let item = if let Some(eng) = inner.engine.as_ref() {
        eng.add_image(&file_name)
    } else if let Some(conv) = inner.conversation.as_mut() {
        let n = conv.items.iter().filter(|i| matches!(i, Item::Image { .. })).count() + 1;
        let item = Item::Image {
            id: format!("img-{n:04}"),
            file: format!("assets/{file_name}"),
            wall_time: chrono::Local::now(),
            caption: None,
        };
        let at = after_item_id
            .and_then(|id| {
                conv.items.iter().position(|i| match i {
                    Item::Utterance { id: iid, .. } | Item::Image { id: iid, .. } => *iid == id,
                })
            })
            .map(|p| p + 1)
            .unwrap_or(conv.items.len());
        conv.items.insert(at, item.clone());
        item
    } else {
        return Err("no active conversation".into());
    };

    inner.staged_images.push((file_name, src));
    Ok(item)
}

#[tauri::command]
pub fn rename_speaker(
    app: AppHandle,
    state: State<'_, AppState>,
    speaker_id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name cannot be empty".into());
    }
    let mut inner = state.0.lock().unwrap();
    let sp = if let Some(eng) = inner.engine.as_ref() {
        eng.rename_speaker(&speaker_id, name)
    } else if let Some(conv) = inner.conversation.as_mut() {
        conv.speakers.iter_mut().find(|s| s.id == speaker_id).map(|sp| {
            sp.name = name.to_string();
            sp.auto_named = false;
            sp.clone()
        })
    } else {
        None
    };
    let sp = sp.ok_or("unknown speaker")?;
    app.emit("timeline/speaker-updated", &EngineEvent::SpeakerUpdated(sp))
        .map_err(err)
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct Settings {
    pub keep_audio: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { keep_audio: true }
    }
}

#[tauri::command]
pub fn get_settings() -> Settings {
    std::fs::read_to_string(crate::paths::settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_settings(settings: Settings) -> Result<(), String> {
    let path = crate::paths::settings_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&settings).map_err(err)?).map_err(err)
}

#[tauri::command]
pub fn check_recovery() -> Option<Conversation> {
    let json = std::fs::read_to_string(crate::paths::recovery_json()).ok()?;
    serde_json::from_str(&json).ok()
}

#[tauri::command]
pub fn recover(state: State<'_, AppState>) -> Result<Conversation, String> {
    let json = std::fs::read_to_string(crate::paths::recovery_json())
        .map_err(|_| "no recovery file")?;
    let conv: Conversation = serde_json::from_str(&json).map_err(err)?;
    // Recovered audio: raw i16 PCM appended by the autosave thread.
    let audio_ogg = std::fs::read(crate::paths::recovery_pcm()).ok().and_then(|bytes| {
        let samples: Vec<f32> = bytes
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect();
        encode_ogg(&samples).ok()
    });
    let mut inner = state.0.lock().unwrap();
    inner.conversation = Some(conv.clone());
    inner.audio_ogg = audio_ogg;
    inner.staged_images.clear(); // dropped-image sources are unknowable post-crash
    Ok(conv)
}

#[tauri::command]
pub fn discard_recovery() {
    crate::paths::clear_recovery();
}

#[tauri::command]
pub fn new_conversation(state: State<'_, AppState>) -> Result<(), String> {
    let mut inner = state.0.lock().unwrap();
    if inner.engine.is_some() {
        return Err("stop the current recording first".into());
    }
    inner.conversation = None;
    inner.audio_ogg = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn encode_ogg_produces_ogg_magic() {
        let samples: Vec<f32> = (0..16000).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        let ogg = super::encode_ogg(&samples).unwrap();
        assert_eq!(&ogg[0..4], b"OggS");
    }
}
