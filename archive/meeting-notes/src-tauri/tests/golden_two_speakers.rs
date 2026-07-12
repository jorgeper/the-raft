//! Golden-audio M2 acceptance test: a scripted two-voice conversation where
//! Alice introduces herself mid-meeting. Asserts diarization separates the
//! voices and the "I am Alice" rename applies retroactively to her earlier
//! utterances (spec §5.2).

use minutes_lib::audio::{load_wav_16k_mono, WavFileSource};
use minutes_lib::document::Item;
use minutes_lib::engine::Engine;
use std::path::Path;
use std::time::Duration;

fn models_ready() -> bool {
    if !minutes_lib::stt::model_path("small").exists()
        || !minutes_lib::diar::embedding_model_path().exists()
    {
        eprintln!("SKIP: models missing, run scripts/fetch-models.sh (small + embedding)");
        return false;
    }
    true
}

#[test]
fn alice_is_labeled_retroactively() {
    if !models_ready() {
        return;
    }

    // alice-1 (pre-introduction) → bob-1 → alice-2 ("I am Alice…") → bob-2
    let names = ["alice-1", "bob-1", "alice-2", "bob-2"];
    let gap = vec![0.0f32; 16000]; // 1 s silence
    let mut samples = Vec::new();
    for (i, n) in names.iter().enumerate() {
        if i > 0 {
            samples.extend_from_slice(&gap);
        }
        samples
            .extend(load_wav_16k_mono(Path::new(&format!("tests/fixtures/{n}.wav"))).unwrap());
    }
    let path = std::env::temp_dir().join("minutes-golden-two-speakers.wav");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(&path, spec).unwrap();
    for s in &samples {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap();
    }
    w.finalize().unwrap();

    let (tx, _rx) = crossbeam_channel::unbounded();
    let eng = Engine::start(Box::new(WavFileSource::new(path, false)), "small", tx).unwrap();
    std::thread::sleep(Duration::from_secs(5));
    let (conv, _) = eng.stop().unwrap();

    for sp in &conv.speakers {
        eprintln!("speaker: {} {} auto={}", sp.id, sp.name, sp.auto_named);
    }
    for item in &conv.items {
        if let Item::Utterance { speaker_id, text, .. } = item {
            eprintln!("  [{speaker_id}] {text}");
        }
    }

    // Two distinct voices.
    assert_eq!(conv.speakers.len(), 2, "expected exactly 2 speakers: {:?}", conv.speakers);

    // Alice was auto-named from her self-introduction.
    let alice = conv
        .speakers
        .iter()
        .find(|s| s.name == "Alice")
        .expect("a speaker should have been auto-named Alice");
    assert!(alice.auto_named);

    // Bob never introduced himself: still a numbered speaker.
    let other = conv.speakers.iter().find(|s| s.id != alice.id).unwrap();
    assert!(
        other.name.starts_with("Speaker "),
        "bob should remain unnamed, got {}",
        other.name
    );

    // Retroactive property: Alice's FIRST utterance (spoken before she
    // introduced herself) carries her speaker id.
    let utterances: Vec<(&str, &str)> = conv
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Utterance { speaker_id, text, .. } => {
                Some((speaker_id.as_str(), text.as_str()))
            }
            _ => None,
        })
        .collect();
    assert!(utterances.len() >= 4, "expected 4 utterances, got {utterances:?}");
    let first = utterances
        .iter()
        .find(|(_, t)| t.to_lowercase().contains("ship on tuesday"))
        .expect("alice-1 utterance missing");
    assert_eq!(
        first.0, alice.id,
        "Alice's pre-introduction utterance must be relabeled to her"
    );
}
