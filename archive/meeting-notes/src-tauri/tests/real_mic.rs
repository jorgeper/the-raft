//! Real-microphone end-to-end test (M1 definition-of-done).
//!
//! Ignored by default: needs a machine with a mic, speakers, and the whisper
//! model installed. Run with:
//!   cargo test --test real_mic -- --ignored --nocapture
//!
//! It records from the REAL default microphone while `afplay` speaks the
//! twoparts fixture through the speakers, then asserts the live pipeline
//! transcribed both sentences and reports per-utterance finalization latency.

use minutes_lib::audio::MicSource;
use minutes_lib::document::Item;
use minutes_lib::engine::{Engine, EngineEvent};
use std::time::{Duration, Instant};

#[test]
#[ignore]
fn real_mic_transcribes_room_audio() {
    if !minutes_lib::stt::model_path("small").exists() {
        panic!("model missing — run scripts/fetch-models.sh small");
    }

    let (tx, rx) = crossbeam_channel::unbounded::<EngineEvent>();
    let eng = Engine::start(Box::new(MicSource::new()), "small", tx).unwrap();

    // Speak the fixture into the room.
    let status = std::process::Command::new("afplay")
        .arg("tests/fixtures/twoparts.wav")
        .status()
        .expect("afplay failed to start");
    assert!(status.success(), "afplay exited nonzero");

    // Wait out the trailing silence + whisper drain, watching finals arrive.
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut final_latencies: Vec<(String, Duration)> = Vec::new();
    let mut last_final = Instant::now();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(EngineEvent::Final(Item::Utterance { text, t_end, .. })) => {
                // Latency proxy: wall time since the audio position t_end was
                // captured is hard to get here; the engine logs the precise
                // "finalized utterance Xms after segmenter close" figure.
                final_latencies.push((text, last_final.elapsed()));
                last_final = Instant::now();
            }
            _ => {}
        }
        if final_latencies.len() >= 2 && last_final.elapsed() > Duration::from_secs(3) {
            break;
        }
    }

    let (conv, audio) = eng.stop().unwrap();

    let joined = conv
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Utterance { text, .. } => Some(text.to_lowercase()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    eprintln!("== real-mic transcript: {joined}");
    eprintln!("== captured {:.1}s of audio", audio.len() as f64 / 16000.0);

    assert!(
        joined.contains("first sentence"),
        "mic transcript missing sentence 1: {joined}"
    );
    assert!(
        joined.contains("second sentence"),
        "mic transcript missing sentence 2: {joined}"
    );
    assert!(audio.len() > 16000 * 4, "expected >4s of captured audio");
}
