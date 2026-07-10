//! Speech-to-text engine abstraction over transcribe-rs (SPEC §3).
//! Two families: Parakeet (ONNX, directory models) and Whisper (GGUF files
//! via whisper.cpp — Metal on macOS).

use crate::registry::{EngineFamily, ModelEntry};
use anyhow::{Context, Result};
use std::path::Path;
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;
use transcribe_rs::whisper_cpp::{WhisperEngine, WhisperInferenceParams};

/// A clean, punctuated prompt nudges Whisper toward non-verbatim, well-formed
/// output (research: fillers in the prompt make Whisper verbatim; clean prose
/// keeps it clean).
const WHISPER_INITIAL_PROMPT: &str =
    "The following is a clear, well-punctuated transcription of the speaker's words.";

pub enum SttEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
}

pub struct LoadedModel {
    pub model_id: String,
    engine: SttEngine,
}

impl LoadedModel {
    pub fn load(entry: &ModelEntry, data_dir: &Path) -> Result<Self> {
        let mut loaded = Self::load_path(entry.engine, &entry.engine_path(data_dir))
            .with_context(|| format!("loading model {}", entry.id))?;
        loaded.model_id = entry.id.clone();
        Ok(loaded)
    }

    /// Load from an explicit path (CLI / validation harness).
    pub fn load_path(family: EngineFamily, path: &Path) -> Result<Self> {
        let engine = match family {
            EngineFamily::Whisper => SttEngine::Whisper(
                WhisperEngine::load(path)
                    .map_err(|e| anyhow::anyhow!("loading whisper model: {e}"))?,
            ),
            EngineFamily::Parakeet => SttEngine::Parakeet(
                ParakeetModel::load(path, &Quantization::Int8)
                    .map_err(|e| anyhow::anyhow!("loading parakeet model: {e}"))?,
            ),
        };
        Ok(Self {
            model_id: path.display().to_string(),
            engine,
        })
    }

    /// Transcribe 16 kHz mono f32 samples to raw text.
    pub fn transcribe(&mut self, samples: &[f32]) -> Result<String> {
        let text = match &mut self.engine {
            SttEngine::Whisper(engine) => engine
                .transcribe_with(
                    samples,
                    &WhisperInferenceParams {
                        initial_prompt: Some(WHISPER_INITIAL_PROMPT.to_string()),
                        ..Default::default()
                    },
                )
                .map_err(|e| anyhow::anyhow!("whisper inference: {e}"))?
                .text,
            SttEngine::Parakeet(engine) => engine
                .transcribe_with(
                    samples,
                    &ParakeetParams {
                        timestamp_granularity: Some(TimestampGranularity::Segment),
                        ..Default::default()
                    },
                )
                .map_err(|e| anyhow::anyhow!("parakeet inference: {e}"))?
                .text,
        };
        Ok(text.trim().to_string())
    }
}

/// Read a WAV file into 16 kHz mono f32 samples (for Retry and the CLI).
pub fn read_wav_16k_mono(path: &Path) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::open(path).context("opening wav")?;
    let spec = reader.spec();
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max))
                .collect::<Result<_, _>>()?
        }
    };
    // Downmix to mono.
    let mono: Vec<f32> = if spec.channels > 1 {
        raw.chunks_exact(spec.channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect()
    } else {
        raw
    };
    if spec.sample_rate == 16_000 {
        Ok(mono)
    } else {
        crate::audio::resample_to_16k(&mono, spec.sample_rate)
    }
}
