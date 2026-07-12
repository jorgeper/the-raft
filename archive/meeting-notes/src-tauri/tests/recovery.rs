//! Autosave/recovery integration test. Own process so the env overrides
//! (MINUTES_DATA_DIR, MINUTES_AUTOSAVE_SECS) can't leak into other tests.

use minutes_lib::audio::WavFileSource;
use minutes_lib::document::{Conversation, Item};
use minutes_lib::engine::Engine;
use std::time::Duration;

#[test]
fn autosave_writes_recoverable_snapshot() {
    if !minutes_lib::stt::model_path("small").exists()
        || !minutes_lib::diar::embedding_model_path().exists()
    {
        eprintln!("SKIP: models missing");
        return;
    }
    let dir = std::env::temp_dir().join(format!("minutes-recovery-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("MINUTES_DATA_DIR", &dir);
    std::env::set_var("MINUTES_AUTOSAVE_SECS", "1");

    let (tx, _rx) = crossbeam_channel::unbounded();
    // realtime pacing so the session is still "live" when autosave ticks
    let src = WavFileSource::new("tests/fixtures/twoparts.wav", true);
    let eng = Engine::start(Box::new(src), "small", tx).unwrap();

    // Wait long enough for the file to stream (~5.4s), whisper to finalize,
    // and at least one autosave tick after that.
    std::thread::sleep(Duration::from_secs(9));

    // Simulate a crash: do NOT call stop; just inspect the recovery files.
    let json_path = minutes_lib::paths::recovery_json();
    assert!(json_path.exists(), "autosave should have written {}", json_path.display());
    let conv: Conversation =
        serde_json::from_str(&std::fs::read_to_string(&json_path).unwrap()).unwrap();
    let texts: Vec<String> = conv
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Utterance { text, .. } => Some(text.to_lowercase()),
            _ => None,
        })
        .collect();
    assert!(
        texts.iter().any(|t| t.contains("first sentence")),
        "recovered transcript missing content: {texts:?}"
    );

    let pcm = minutes_lib::paths::recovery_pcm();
    assert!(pcm.exists());
    assert!(
        std::fs::metadata(&pcm).unwrap().len() > 16000,
        "recovered PCM should hold real audio"
    );

    // Cleanup (also verifies the engine can still shut down cleanly).
    eng.stop().unwrap();
    std::fs::remove_dir_all(&dir).ok();
}
