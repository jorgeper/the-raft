//! Audio sources. Everything downstream of a source is 16 kHz mono f32.

use anyhow::{Context, Result};
use crossbeam_channel::Sender;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const SAMPLE_RATE: u32 = 16_000;
pub const CHUNK: usize = 512;

pub trait AudioSource: Send {
    /// Start streaming 16 kHz mono f32 chunks into `tx`. Non-blocking; spawns a thread.
    fn start(&mut self, tx: Sender<Vec<f32>>) -> Result<()>;
    fn stop(&mut self);
}

pub fn resample_linear(input: &[f32], from_hz: u32, to_hz: u32) -> Vec<f32> {
    if from_hz == to_hz || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_hz as f64 / to_hz as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input[idx];
        let b = if idx + 1 < input.len() { input[idx + 1] } else { a };
        out.push(a + (b - a) * frac);
    }
    out
}

pub fn load_wav_16k_mono(path: &Path) -> Result<Vec<f32>> {
    let mut reader =
        hound::WavReader::open(path).with_context(|| format!("opening {}", path.display()))?;
    let spec = reader.spec();
    anyhow::ensure!(spec.channels == 1, "fixture must be mono, got {}ch", spec.channels);
    anyhow::ensure!(
        spec.sample_rate == SAMPLE_RATE,
        "fixture must be 16kHz, got {}",
        spec.sample_rate
    );
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / 32768.0))
            .collect::<std::result::Result<_, _>>()?,
        hound::SampleFormat::Float => {
            reader.samples::<f32>().collect::<std::result::Result<_, _>>()?
        }
    };
    Ok(samples)
}

/// Streams a 16 kHz mono WAV file; `realtime` paces it at wall-clock speed.
pub struct WavFileSource {
    pub path: PathBuf,
    pub realtime: bool,
    stop: Arc<AtomicBool>,
}

impl WavFileSource {
    pub fn new(path: impl Into<PathBuf>, realtime: bool) -> Self {
        WavFileSource { path: path.into(), realtime, stop: Arc::new(AtomicBool::new(false)) }
    }
}

impl AudioSource for WavFileSource {
    fn start(&mut self, tx: Sender<Vec<f32>>) -> Result<()> {
        let samples = load_wav_16k_mono(&self.path)?;
        let realtime = self.realtime;
        let stop = self.stop.clone();
        std::thread::spawn(move || {
            for chunk in samples.chunks(CHUNK) {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if tx.send(chunk.to_vec()).is_err() {
                    break;
                }
                if realtime {
                    std::thread::sleep(std::time::Duration::from_millis(
                        (CHUNK as u64 * 1000) / SAMPLE_RATE as u64,
                    ));
                }
            }
            // Sender drops here; downstream sees channel close as end-of-stream.
        });
        Ok(())
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Default microphone via cpal, downmixed to mono and resampled to 16 kHz.
///
/// `cpal::Stream` is `!Send`, so the stream lives entirely on a dedicated
/// thread that parks until `stop()`.
pub struct MicSource {
    stop: Arc<AtomicBool>,
}

impl MicSource {
    pub fn new() -> Self {
        MicSource { stop: Arc::new(AtomicBool::new(false)) }
    }
}

impl AudioSource for MicSource {
    fn start(&mut self, tx: Sender<Vec<f32>>) -> Result<()> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let stop = self.stop.clone();
        let (ready_tx, ready_rx) = crossbeam_channel::bounded::<Result<()>>(1);

        std::thread::spawn(move || {
            let build = (|| -> Result<(cpal::Stream, u32)> {
                let host = cpal::default_host();
                let device = host
                    .default_input_device()
                    .context("no default input device")?;
                let config = device.default_input_config().context("no input config")?;
                let native_rate = config.sample_rate();
                let channels = config.channels() as usize;
                let stream = device.build_input_stream(
                    config.into(),
                    move |data: &[f32], _| {
                        // Downmix interleaved channels to mono.
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                            .collect();
                        let resampled = resample_linear(&mono, native_rate, SAMPLE_RATE);
                        let _ = tx.send(resampled);
                    },
                    |err| eprintln!("cpal stream error: {err}"),
                    None,
                )?;
                stream.play()?;
                Ok((stream, native_rate))
            })();

            match build {
                Ok((stream, rate)) => {
                    let _ = ready_tx.send(Ok(()));
                    eprintln!("mic capture started at {rate} Hz native");
                    while !stop.load(Ordering::Relaxed) {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        });

        ready_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .context("mic init timed out")?
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_halves_length() {
        let input: Vec<f32> = (0..32000).map(|i| (i as f32 * 0.001).sin()).collect();
        let out = resample_linear(&input, 32000, 16000);
        assert!((out.len() as i64 - 16000).abs() <= 2, "len {}", out.len());
    }

    #[test]
    fn resample_identity_when_rates_match() {
        let input = vec![0.5f32; 1000];
        assert_eq!(resample_linear(&input, 16000, 16000).len(), 1000);
    }

    #[test]
    fn wav_source_streams_all_samples() {
        let path = Path::new("tests/fixtures/hello.wav");
        let all = load_wav_16k_mono(path).unwrap();
        let (tx, rx) = crossbeam_channel::unbounded();
        let mut src = WavFileSource::new(path, false);
        src.start(tx).unwrap();
        let mut n = 0usize;
        while let Ok(chunk) = rx.recv_timeout(std::time::Duration::from_secs(5)) {
            n += chunk.len();
        }
        assert_eq!(n, all.len());
        assert!(n > 16000, "fixture should be >1s of audio, got {n} samples");
    }
}
