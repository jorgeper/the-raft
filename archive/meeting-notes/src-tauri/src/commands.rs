//! Tauri commands and the engine→webview event bridge.

use crate::audio::{AudioSource, MicSource, WavFileSource};
use crate::document::{read_mnote, write_mnote, Conversation};
use crate::engine::{Engine, EngineEvent};
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub const DEFAULT_MODEL: &str = "small";

#[derive(Default)]
pub struct Inner {
    pub engine: Option<Engine>,
    pub conversation: Option<Conversation>,
    pub audio_ogg: Option<Vec<u8>>,
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
    write_mnote(&path, conv, inner.audio_ogg.as_deref()).map_err(err)
}

#[tauri::command]
pub fn open(path: String, state: State<'_, AppState>) -> Result<Conversation, String> {
    let conv = read_mnote(&PathBuf::from(path)).map_err(err)?;
    let mut inner = state.0.lock().unwrap();
    inner.conversation = Some(conv.clone());
    inner.audio_ogg = None; // audio stays inside the source .mnote; M1 never rewrites it on open
    Ok(conv)
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
