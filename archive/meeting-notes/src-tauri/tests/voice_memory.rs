//! Voice-memory acceptance test (spec §5.3): remember a voice after one
//! session, and a brand-new session auto-names that speaker on arrival.
//! Own process because it overrides MINUTES_DATA_DIR.

use minutes_lib::audio::WavFileSource;
use minutes_lib::document::{Item, Speaker};
use minutes_lib::engine::Engine;
use std::time::Duration;

fn run_session(fixture: &str) -> (Vec<Speaker>, Vec<(String, String)>) {
    let (tx, _rx) = crossbeam_channel::unbounded();
    let src = WavFileSource::new(format!("tests/fixtures/{fixture}.wav"), false);
    let eng = Engine::start(Box::new(src), "small", tx).unwrap();
    std::thread::sleep(Duration::from_secs(3));
    let (conv, _) = eng.stop().unwrap();
    let utts = conv
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Utterance { speaker_id, text, .. } => {
                Some((speaker_id.clone(), text.clone()))
            }
            _ => None,
        })
        .collect();
    (conv.speakers, utts)
}

#[test]
fn remembered_voice_is_auto_named_in_next_session() {
    if !minutes_lib::stt::model_path("small").exists()
        || !minutes_lib::diar::embedding_model_path().exists()
    {
        eprintln!("SKIP: models missing");
        return;
    }
    let dir = std::env::temp_dir().join(format!("minutes-voicemem-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("MINUTES_DATA_DIR", &dir);

    // Session A: Alice speaks; nothing in the library yet.
    let (speakers_a, _) = run_session("alice-1");
    assert_eq!(speakers_a.len(), 1);
    assert_eq!(speakers_a[0].name, "Speaker 1", "library is empty, no auto-name");
    let embedding = speakers_a[0]
        .embedding
        .clone()
        .expect("stop() must attach the voiceprint");

    // User clicks "Remember this voice" (the command layer does exactly this).
    minutes_lib::voices::remember("Alice", embedding, "conv-a").unwrap();

    // Session B: fresh engine, different Alice utterance → auto-named on arrival.
    let (speakers_b, _) = run_session("alice-2");
    assert_eq!(speakers_b.len(), 1);
    assert_eq!(speakers_b[0].name, "Alice", "returning voice should be auto-named");
    assert!(speakers_b[0].auto_named);

    // A different voice must NOT match Alice's print.
    let (speakers_c, _) = run_session("bob-1");
    assert_eq!(speakers_c.len(), 1);
    assert!(
        speakers_c[0].name.starts_with("Speaker "),
        "bob must not be mistaken for Alice, got {}",
        speakers_c[0].name
    );

    std::fs::remove_dir_all(&dir).ok();
}
