//! whisper.cpp transcription (Metal on macOS).

use anyhow::{Context, Result};
use std::path::PathBuf;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub fn models_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("MINUTES_MODELS_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .expect("no platform data dir")
        .join("com.jorgeper.minutes")
        .join("models")
}

pub fn model_path(name: &str) -> PathBuf {
    models_dir().join(format!("ggml-{name}.bin"))
}

pub struct Transcriber {
    ctx: WhisperContext,
    threads: i32,
}

impl Transcriber {
    pub fn load(model: &str) -> Result<Self> {
        let path = model_path(model);
        anyhow::ensure!(
            path.exists(),
            "model file missing: {} (run scripts/fetch-models.sh {model})",
            path.display()
        );
        let ctx = WhisperContext::new_with_params(
            path.to_str().context("non-utf8 model path")?,
            WhisperContextParameters::default(),
        )
        .context("loading whisper model")?;
        let threads = std::thread::available_parallelism()
            .map(|n| (n.get() / 2).max(2) as i32)
            .unwrap_or(4);
        Ok(Transcriber { ctx, threads })
    }

    pub fn transcribe(&mut self, samples: &[f32]) -> Result<String> {
        // whisper needs at least ~1s of context to behave; pad short clips.
        let mut padded;
        let input = if samples.len() < 16_000 {
            padded = samples.to_vec();
            padded.resize(16_000 + 4_000, 0.0);
            &padded[..]
        } else {
            samples
        };

        let mut state = self.ctx.create_state().context("creating whisper state")?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_context(true);
        params.set_suppress_blank(true);
        params.set_n_threads(self.threads);

        state.full(params, input).context("whisper full() failed")?;

        let mut out = String::new();
        for i in 0..state.full_n_segments() {
            if let Some(segment) = state.get_segment(i) {
                let text = segment.to_str_lossy().context("segment text")?.to_string();
                let trimmed = text.trim();
                if is_artifact(trimmed) {
                    continue;
                }
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(trimmed);
            }
        }
        Ok(out.trim().to_string())
    }
}

/// Whisper emits non-speech markers on noise/music; drop them.
fn is_artifact(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }
    let bracketed = (s.starts_with('[') && s.ends_with(']'))
        || (s.starts_with('(') && s.ends_with(')'));
    bracketed || s.chars().all(|c| c == '♪' || c.is_whitespace() || c == '.')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::load_wav_16k_mono;

    #[test]
    fn artifact_filter() {
        assert!(is_artifact("[BLANK_AUDIO]"));
        assert!(is_artifact("(wind blowing)"));
        assert!(is_artifact("♪"));
        assert!(!is_artifact("hello there"));
    }

    #[test]
    fn transcribes_hello_fixture() {
        let mp = model_path("small");
        if !mp.exists() {
            eprintln!("SKIP: model missing at {}, run scripts/fetch-models.sh", mp.display());
            return;
        }
        let mut t = Transcriber::load("small").unwrap();
        let audio = load_wav_16k_mono(std::path::Path::new("tests/fixtures/hello.wav")).unwrap();
        let started = std::time::Instant::now();
        let text = t.transcribe(&audio).unwrap().to_lowercase();
        eprintln!("transcribed in {:?}: {text}", started.elapsed());
        assert!(text.contains("hello"), "got: {text}");
        assert!(text.contains("minutes"), "got: {text}");
    }
}
