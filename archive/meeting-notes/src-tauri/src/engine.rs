//! Realtime engine: audio source → VAD segmenter → whisper worker → events.

use crate::audio::AudioSource;
use crate::document::{Conversation, Item};
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
}

struct Shared {
    paused: AtomicBool,
    conversation: Mutex<Conversation>,
    session_audio: Mutex<Vec<f32>>,
    utterance_count: Mutex<u32>,
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
        // Load the model before starting capture so a missing model fails fast.
        let transcriber = Transcriber::load(model)?;

        let shared = Arc::new(Shared {
            paused: AtomicBool::new(false),
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
        let stt_handle = spawn_stt(
            shared.clone(),
            transcriber,
            utt_rx,
            open_snapshot,
            events.clone(),
        );

        let _ = events.send(EngineEvent::Status { state: "recording".into() });
        Ok(Engine { shared, source, events, seg_handle, stt_handle })
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
                            let item = {
                                let mut conv = shared.conversation.lock().unwrap();
                                let mut count = shared.utterance_count.lock().unwrap();
                                *count += 1;
                                let item = Item::Utterance {
                                    id: format!("utt-{:04}", *count),
                                    speaker_id: conv.speakers[0].id.clone(),
                                    text,
                                    t_start: utt.t_start,
                                    t_end: utt.t_end,
                                    wall_time: chrono::Local::now(),
                                };
                                conv.items.push(item.clone());
                                item
                            };
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

    #[test]
    fn wav_session_produces_final_utterances_and_document() {
        if !crate::stt::model_path("small").exists() {
            eprintln!("SKIP: no model");
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
