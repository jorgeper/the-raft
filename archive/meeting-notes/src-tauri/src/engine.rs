//! Realtime engine: audio source → VAD segmenter → whisper worker → events.

use crate::audio::AudioSource;
use crate::diar::Diarizer;
use crate::document::{Conversation, Item, Speaker};
use crate::stt::Transcriber;
use crate::vad::{Segmenter, Utterance};
use anyhow::Result;
use crossbeam_channel::{Receiver, Sender};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PARTIAL_INTERVAL: Duration = Duration::from_millis(1500);
const LEVEL_INTERVAL: Duration = Duration::from_millis(66); // ~15 Hz

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineEvent {
    #[serde(rename_all = "camelCase")]
    Partial { utterance_id: String, text: String },
    Final(Item),
    #[serde(rename_all = "camelCase")]
    Level { rms: f32 },
    #[serde(rename_all = "camelCase")]
    Status { state: String },
    SpeakerUpdated(Speaker),
}

struct Shared {
    paused: AtomicBool,
    stopped: AtomicBool,
    conversation: Mutex<Conversation>,
    session_audio: Mutex<Vec<f32>>,
    utterance_count: Mutex<u32>,
}

/// Snapshots the conversation to the recovery file every `MINUTES_AUTOSAVE_SECS`
/// (default 30) and appends new session audio as raw i16 PCM, so a crash loses
/// at most one interval of audio and no transcript (spec §4.3).
fn spawn_autosave(shared: Arc<Shared>) {
    let interval: u64 = std::env::var("MINUTES_AUTOSAVE_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    if interval == 0 {
        return;
    }
    std::thread::spawn(move || {
        let mut audio_cursor = 0usize;
        let mut last_save = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(250));
            if shared.stopped.load(Ordering::Relaxed) {
                return;
            }
            if last_save.elapsed() < Duration::from_secs(interval) {
                continue;
            }
            last_save = Instant::now();

            let json_path = crate::paths::recovery_json();
            if let Some(dir) = json_path.parent() {
                std::fs::create_dir_all(dir).ok();
            }
            let conv = shared.conversation.lock().unwrap().clone();
            if let Ok(json) = serde_json::to_string(&conv) {
                let tmp = json_path.with_extension("json.tmp");
                if std::fs::write(&tmp, json).is_ok() {
                    std::fs::rename(&tmp, &json_path).ok();
                }
            }

            let delta: Vec<f32> = {
                let audio = shared.session_audio.lock().unwrap();
                audio[audio_cursor.min(audio.len())..].to_vec()
            };
            if !delta.is_empty() {
                use std::io::Write;
                let mut bytes = Vec::with_capacity(delta.len() * 2);
                for s in &delta {
                    bytes.extend_from_slice(
                        &(((s.clamp(-1.0, 1.0)) * 32767.0) as i16).to_le_bytes(),
                    );
                }
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(crate::paths::recovery_pcm())
                {
                    if f.write_all(&bytes).is_ok() {
                        audio_cursor += delta.len();
                    }
                }
            }
        }
    });
}

pub struct Engine {
    shared: Arc<Shared>,
    source: Box<dyn AudioSource>,
    events: Sender<EngineEvent>,
    seg_handle: std::thread::JoinHandle<()>,
    stt_handle: std::thread::JoinHandle<()>,
}

impl Engine {
    pub fn start(
        mut source: Box<dyn AudioSource>,
        model: &str,
        events: Sender<EngineEvent>,
    ) -> Result<Engine> {
        // Load models before starting capture so missing files fail fast.
        let transcriber = Transcriber::load(model)?;
        let diarizer = Diarizer::load()?;

        let shared = Arc::new(Shared {
            paused: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            conversation: Mutex::new(Conversation::new_recording(model)),
            session_audio: Mutex::new(Vec::new()),
            utterance_count: Mutex::new(0),
        });

        let (chunk_tx, chunk_rx) = crossbeam_channel::unbounded::<Vec<f32>>();
        let (utt_tx, utt_rx) = crossbeam_channel::unbounded::<Utterance>();
        // Snapshot of the open utterance for partial transcription.
        let open_snapshot: Arc<Mutex<Option<Vec<f32>>>> = Arc::new(Mutex::new(None));

        source.start(chunk_tx)?;

        let seg_handle = spawn_segmenter(
            shared.clone(),
            chunk_rx,
            utt_tx,
            open_snapshot.clone(),
            events.clone(),
        );
        spawn_autosave(shared.clone());
        let stt_handle = spawn_stt(
            shared.clone(),
            transcriber,
            diarizer,
            utt_rx,
            open_snapshot,
            events.clone(),
        );

        let _ = events.send(EngineEvent::Status { state: "recording".into() });
        Ok(Engine { shared, source, events, seg_handle, stt_handle })
    }

    /// Insert a dropped image into the live timeline at the current moment.
    pub fn add_image(&self, file_name: &str) -> Item {
        let mut conv = self.shared.conversation.lock().unwrap();
        let n = conv.items.iter().filter(|i| matches!(i, Item::Image { .. })).count() + 1;
        let item = Item::Image {
            id: format!("img-{n:04}"),
            file: format!("assets/{file_name}"),
            wall_time: chrono::Local::now(),
            caption: None,
        };
        conv.items.push(item.clone());
        item
    }

    /// Manual rename from the UI; wins over any future "I am X" for this speaker.
    pub fn rename_speaker(&self, speaker_id: &str, name: &str) -> Option<Speaker> {
        let mut conv = self.shared.conversation.lock().unwrap();
        let sp = conv.speakers.iter_mut().find(|s| s.id == speaker_id)?;
        sp.name = name.to_string();
        sp.auto_named = false;
        Some(sp.clone())
    }

    pub fn pause(&self) {
        self.shared.paused.store(true, Ordering::Relaxed);
        let _ = self.events.send(EngineEvent::Status { state: "paused".into() });
    }

    pub fn resume(&self) {
        self.shared.paused.store(false, Ordering::Relaxed);
        let _ = self.events.send(EngineEvent::Status { state: "recording".into() });
    }

    /// Stop capture, drain both workers, return the finished conversation and
    /// the full 16 kHz session audio.
    pub fn stop(mut self) -> Result<(Conversation, Vec<f32>)> {
        self.shared.stopped.store(true, Ordering::Relaxed);
        self.source.stop();
        // Segmenter exits when the source's chunk sender drops (WavFileSource
        // drops it at end-of-file; MicSource when its thread sees the stop flag).
        self.seg_handle.join().ok();
        self.stt_handle.join().ok();
        let _ = self.events.send(EngineEvent::Status { state: "stopped".into() });

        let mut conv = self.shared.conversation.lock().unwrap().clone();
        conv.ended_at = Some(chrono::Local::now());
        let audio = std::mem::take(&mut *self.shared.session_audio.lock().unwrap());
        Ok((conv, audio))
    }
}

fn spawn_segmenter(
    shared: Arc<Shared>,
    chunk_rx: Receiver<Vec<f32>>,
    utt_tx: Sender<Utterance>,
    open_snapshot: Arc<Mutex<Option<Vec<f32>>>>,
    events: Sender<EngineEvent>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut seg = match Segmenter::new() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("segmenter init failed: {e}");
                return;
            }
        };
        let mut last_level = Instant::now();
        while let Ok(chunk) = chunk_rx.recv() {
            if shared.paused.load(Ordering::Relaxed) {
                continue; // paused audio is dropped everywhere: t_* stays pause-adjusted
            }
            if last_level.elapsed() >= LEVEL_INTERVAL {
                let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len().max(1) as f32)
                    .sqrt();
                let _ = events.send(EngineEvent::Level { rms });
                last_level = Instant::now();
            }
            shared.session_audio.lock().unwrap().extend_from_slice(&chunk);
            for utt in seg.push(&chunk) {
                let _ = utt_tx.send(utt);
            }
            *open_snapshot.lock().unwrap() = seg.open_snapshot().map(|(s, _)| s);
        }
        if let Some(utt) = seg.flush() {
            let _ = utt_tx.send(utt);
        }
        // utt_tx drops here; stt worker drains and exits.
    })
}

fn spawn_stt(
    shared: Arc<Shared>,
    mut transcriber: Transcriber,
    mut diarizer: Diarizer,
    utt_rx: Receiver<Utterance>,
    open_snapshot: Arc<Mutex<Option<Vec<f32>>>>,
    events: Sender<EngineEvent>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut last_partial = Instant::now();
        let mut last_partial_len = 0usize;
        loop {
            match utt_rx.recv_timeout(Duration::from_millis(300)) {
                Ok(utt) => {
                    let closed_at = Instant::now();
                    match transcriber.transcribe(&utt.samples) {
                        Ok(text) if !text.is_empty() => {
                            let speaker_idx = match diarizer.assign(&utt.samples) {
                                Ok(idx) => idx,
                                Err(e) => {
                                    eprintln!("diarization failed: {e}");
                                    0
                                }
                            };
                            let (item, new_speaker, renamed) = {
                                let mut conv = shared.conversation.lock().unwrap();
                                let (speaker_id, created) = conv.ensure_speaker(speaker_idx);
                                let new_speaker =
                                    created.then(|| conv.speakers[speaker_idx].clone());
                                // "I am X": rename this utterance's speaker,
                                // retroactively and going forward, unless a
                                // human already named them (spec §5.2).
                                let renamed = crate::namer::detect_self_name(&text)
                                    .and_then(|name| {
                                        let sp = &mut conv.speakers[speaker_idx];
                                        let untouched = sp.name.starts_with("Speaker ");
                                        (untouched || sp.auto_named).then(|| {
                                            sp.name = name;
                                            sp.auto_named = true;
                                            sp.clone()
                                        })
                                    });
                                let mut count = shared.utterance_count.lock().unwrap();
                                *count += 1;
                                let item = Item::Utterance {
                                    id: format!("utt-{:04}", *count),
                                    speaker_id,
                                    text,
                                    t_start: utt.t_start,
                                    t_end: utt.t_end,
                                    wall_time: chrono::Local::now(),
                                };
                                conv.items.push(item.clone());
                                (item, new_speaker, renamed)
                            };
                            if let Some(sp) = new_speaker {
                                let _ = events.send(EngineEvent::SpeakerUpdated(sp));
                            }
                            if let Some(sp) = renamed {
                                let _ = events.send(EngineEvent::SpeakerUpdated(sp));
                            }
                            eprintln!(
                                "finalized utterance {}ms after segmenter close",
                                closed_at.elapsed().as_millis()
                            );
                            let _ = events.send(EngineEvent::Final(item));
                        }
                        Ok(_) => {} // artifact-only utterance, skip
                        Err(e) => eprintln!("transcription failed: {e}"),
                    }
                    last_partial = Instant::now(); // don't immediately re-partial
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    if last_partial.elapsed() < PARTIAL_INTERVAL {
                        continue;
                    }
                    let snapshot = open_snapshot.lock().unwrap().clone();
                    if let Some(samples) = snapshot {
                        // Only re-run when the utterance has grown meaningfully.
                        if samples.len() < 8_000 || samples.len() <= last_partial_len + 4_000 {
                            continue;
                        }
                        last_partial_len = samples.len();
                        if let Ok(text) = transcriber.transcribe(&samples) {
                            if !text.is_empty() {
                                let next = *shared.utterance_count.lock().unwrap() + 1;
                                let _ = events.send(EngineEvent::Partial {
                                    utterance_id: format!("utt-{next:04}"),
                                    text,
                                });
                            }
                        }
                        last_partial = Instant::now();
                    } else {
                        last_partial_len = 0;
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::WavFileSource;

    fn models_ready() -> bool {
        if !crate::stt::model_path("small").exists()
            || !crate::diar::embedding_model_path().exists()
        {
            eprintln!("SKIP: models missing, run scripts/fetch-models.sh (small + embedding)");
            return false;
        }
        true
    }

    /// Concatenate fixtures with `gap_s` of silence between them into one buffer.
    fn concat_fixtures(names: &[&str], gap_s: f32) -> Vec<f32> {
        let gap = vec![0.0f32; (gap_s * 16000.0) as usize];
        let mut out = Vec::new();
        for (i, name) in names.iter().enumerate() {
            if i > 0 {
                out.extend_from_slice(&gap);
            }
            out.extend(
                crate::audio::load_wav_16k_mono(std::path::Path::new(&format!(
                    "tests/fixtures/{name}.wav"
                )))
                .unwrap(),
            );
        }
        out
    }

    fn write_temp_wav(samples: &[f32], name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(name);
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        for s in samples {
            w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap();
        }
        w.finalize().unwrap();
        path
    }

    #[test]
    fn two_speaker_session_creates_two_speakers() {
        if !models_ready() {
            return;
        }
        let samples = concat_fixtures(&["alice-1", "bob-1", "alice-2", "bob-2"], 1.0);
        let path = write_temp_wav(&samples, "minutes-two-speakers.wav");
        let (tx, rx) = crossbeam_channel::unbounded();
        let src = WavFileSource::new(path, false);
        let eng = Engine::start(Box::new(src), "small", tx).unwrap();
        std::thread::sleep(Duration::from_secs(4));
        let (conv, _) = eng.stop().unwrap();

        assert!(conv.speakers.len() >= 2, "expected >=2 speakers, got {:?}", conv.speakers);
        let mut ids: Vec<&str> = conv
            .items
            .iter()
            .filter_map(|i| match i {
                Item::Utterance { speaker_id, .. } => Some(speaker_id.as_str()),
                _ => None,
            })
            .collect();
        ids.dedup();
        assert!(ids.len() >= 2, "utterances should not all share one speaker: {ids:?}");

        let speaker_events = rx
            .try_iter()
            .filter(|e| matches!(e, EngineEvent::SpeakerUpdated(_)))
            .count();
        assert!(speaker_events >= 2, "expected SpeakerUpdated per new speaker");
    }

    #[test]
    fn pause_drops_audio_and_keeps_time_continuous() {
        if !models_ready() {
            return;
        }
        let full = crate::audio::load_wav_16k_mono(std::path::Path::new(
            "tests/fixtures/twoparts.wav",
        ))
        .unwrap();
        let (tx, _rx) = crossbeam_channel::unbounded();
        // realtime pacing so pause windows map to real audio spans
        let src = WavFileSource::new("tests/fixtures/twoparts.wav", true);
        let eng = Engine::start(Box::new(src), "small", tx).unwrap();
        std::thread::sleep(Duration::from_secs(1));
        eng.pause();
        std::thread::sleep(Duration::from_secs(2));
        eng.resume();
        std::thread::sleep(Duration::from_secs(5)); // file finishes streaming
        let (conv, audio) = eng.stop().unwrap();

        // ~2s of paused audio must be missing from the session buffer.
        assert!(
            audio.len() < full.len() - 16000,
            "paused audio was not dropped: kept {} of {}",
            audio.len(),
            full.len()
        );
        assert!(audio.len() > 16000, "should still keep unpaused audio");

        // t_* index into the pause-adjusted session audio, so every utterance
        // must fit inside it.
        let session_secs = audio.len() as f64 / 16000.0;
        for item in &conv.items {
            if let Item::Utterance { t_start, t_end, .. } = item {
                assert!(t_end > t_start);
                assert!(
                    *t_end <= session_secs + 0.25,
                    "t_end {t_end} outside session audio {session_secs}"
                );
            }
        }
    }

    #[test]
    fn wav_session_produces_final_utterances_and_document() {
        if !models_ready() {
            return;
        }
        let (tx, rx) = crossbeam_channel::unbounded();
        let src = WavFileSource::new("tests/fixtures/twoparts.wav", false);
        let eng = Engine::start(Box::new(src), "small", tx).unwrap();
        // File drains almost instantly (realtime=false); give whisper time.
        std::thread::sleep(Duration::from_secs(2));
        let (conv, audio) = eng.stop().unwrap();

        let finals: Vec<String> = conv
            .items
            .iter()
            .filter_map(|i| match i {
                Item::Utterance { text, .. } => Some(text.to_lowercase()),
                _ => None,
            })
            .collect();
        assert!(finals.len() >= 2, "expected >=2 utterances, got {finals:?}");
        let joined = finals.join(" ");
        assert!(joined.contains("first sentence"), "got: {joined}");
        assert!(joined.contains("second sentence"), "got: {joined}");
        assert!(audio.len() > 16000);

        let evs: Vec<EngineEvent> = rx.try_iter().collect();
        assert!(evs.iter().any(|e| matches!(e, EngineEvent::Final(_))));
        assert!(evs.iter().any(|e| matches!(e, EngineEvent::Status { .. })));
    }
}
