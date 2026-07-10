//! Microphone capture (SPEC §2): cpal at the device's native config, mono
//! downmix, software resample to 16 kHz. Levels for the overlay waveform are
//! emitted ~30×/s while recording.
//!
//! The cpal Stream is !Send, so it lives on a dedicated worker thread that
//! receives commands over a channel (pattern adapted from Handy, MIT).

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FftFixedIn, Resampler};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;

pub const TARGET_RATE: u32 = 16_000;
/// Recordings shorter than 1 s are zero-padded to 1.25 s — tiny buffers make
/// STT engines misbehave.
const MIN_SAMPLES: usize = (TARGET_RATE as usize) * 5 / 4;
/// SPEC FR-1.4: recording auto-stops at 5 minutes.
pub const MAX_RECORD_SECS: u64 = 300;

pub type LevelCallback = Arc<dyn Fn(f32) + Send + Sync + 'static>;

enum Cmd {
    Start {
        device_name: Option<String>,
        reply: mpsc::Sender<Result<()>>,
    },
    Stop {
        reply: mpsc::Sender<Result<Vec<f32>>>,
    },
    Cancel,
    Shutdown,
}

pub struct AudioRecorder {
    tx: mpsc::Sender<Cmd>,
    recording: Arc<AtomicBool>,
}

impl AudioRecorder {
    pub fn new(level_cb: LevelCallback) -> Self {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let recording = Arc::new(AtomicBool::new(false));
        let rec_flag = recording.clone();
        std::thread::Builder::new()
            .name("audio-recorder".into())
            .spawn(move || worker(rx, rec_flag, level_cb))
            .expect("spawn audio worker");
        Self { tx, recording }
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
    }

    pub fn start(&self, device_name: Option<String>) -> Result<()> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(Cmd::Start { device_name, reply })?;
        rx.recv().context("audio worker gone")?
    }

    /// Stop and return all captured samples resampled to 16 kHz mono.
    pub fn stop(&self) -> Result<Vec<f32>> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(Cmd::Stop { reply })?;
        rx.recv().context("audio worker gone")?
    }

    pub fn cancel(&self) {
        let _ = self.tx.send(Cmd::Cancel);
    }
}

impl Drop for AudioRecorder {
    fn drop(&mut self) {
        let _ = self.tx.send(Cmd::Shutdown);
    }
}

struct ActiveStream {
    _stream: cpal::Stream,
    samples_rx: mpsc::Receiver<Vec<f32>>,
    device_rate: u32,
    started: std::time::Instant,
}

fn worker(rx: mpsc::Receiver<Cmd>, recording: Arc<AtomicBool>, level_cb: LevelCallback) {
    let mut active: Option<ActiveStream> = None;
    let mut captured: Vec<f32> = Vec::new();

    loop {
        // Drain any captured audio while recording; poll commands at 10 ms.
        if let Some(stream) = &active {
            while let Ok(chunk) = stream.samples_rx.try_recv() {
                captured.extend_from_slice(&chunk);
            }
            // Safety cap (SPEC FR-1.4).
            if stream.started.elapsed().as_secs() >= MAX_RECORD_SECS {
                log::warn!("recording hit {MAX_RECORD_SECS}s cap; auto-stopping capture");
                // Keep captured audio; stop the stream but stay in "recording"
                // state until the pipeline calls stop() and collects it.
                // (Dropping the stream stops capture.)
                // We simply stop pulling new audio by dropping the stream.
                let rate = stream.device_rate;
                active = None;
                let _ = rate; // rate no longer needed until Stop
            }
        }

        let cmd = match rx.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(cmd) => cmd,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };

        match cmd {
            Cmd::Start { device_name, reply } => {
                captured.clear();
                let result = open_stream(device_name, level_cb.clone());
                match result {
                    Ok((stream, samples_rx, device_rate)) => {
                        active = Some(ActiveStream {
                            _stream: stream,
                            samples_rx,
                            device_rate,
                            started: std::time::Instant::now(),
                        });
                        recording.store(true, Ordering::SeqCst);
                        let _ = reply.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(e));
                    }
                }
            }
            Cmd::Stop { reply } => {
                let device_rate = active.as_ref().map(|s| s.device_rate).unwrap_or(TARGET_RATE);
                if let Some(stream) = &active {
                    // Give the callback a moment to flush, then drain.
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    while let Ok(chunk) = stream.samples_rx.try_recv() {
                        captured.extend_from_slice(&chunk);
                    }
                }
                active = None;
                recording.store(false, Ordering::SeqCst);
                let samples = std::mem::take(&mut captured);
                let _ = reply.send(finish_samples(samples, device_rate));
            }
            Cmd::Cancel => {
                active = None;
                captured.clear();
                recording.store(false, Ordering::SeqCst);
            }
            Cmd::Shutdown => return,
        }
    }
}

fn open_stream(
    device_name: Option<String>,
    level_cb: LevelCallback,
) -> Result<(cpal::Stream, mpsc::Receiver<Vec<f32>>, u32)> {
    let host = cpal::default_host();
    let device = match &device_name {
        Some(name) => host
            .input_devices()?
            .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
            .ok_or_else(|| anyhow!("input device '{name}' not found"))?,
        None => host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default input device"))?,
    };
    let config = device
        .default_input_config()
        .context("querying input config")?;
    let device_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let (tx, rx) = mpsc::channel::<Vec<f32>>();

    // ~33 ms level window at the device rate (≈30 updates/s).
    let level_window = (device_rate / 30) as usize;
    let mut level_acc: Vec<f32> = Vec::with_capacity(level_window);

    macro_rules! build {
        ($t:ty) => {{
            let tx = tx.clone();
            let level_cb = level_cb.clone();
            let mut level_acc = std::mem::take(&mut level_acc);
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[$t], _| {
                    let mono: Vec<f32> = data
                        .chunks_exact(channels)
                        .map(|frame| {
                            frame
                                .iter()
                                .map(|s| cpal::Sample::to_sample::<f32>(*s))
                                .sum::<f32>()
                                / channels as f32
                        })
                        .collect();
                    // Level emission (~30 Hz): RMS -> dB -> 0..1.
                    for &s in &mono {
                        level_acc.push(s);
                        if level_acc.len() >= level_window {
                            let rms = (level_acc.iter().map(|x| x * x).sum::<f32>()
                                / level_acc.len() as f32)
                                .sqrt();
                            let db = 20.0 * (rms.max(1e-9)).log10();
                            // Map -55 dB..-8 dB onto 0..1 (Handy's vocal range).
                            let norm = ((db + 55.0) / 47.0).clamp(0.0, 1.0);
                            level_cb(norm.powf(0.7));
                            level_acc.clear();
                        }
                    }
                    let _ = tx.send(mono);
                },
                |err| log::error!("audio stream error: {err}"),
                None,
            )?
        }};
    }

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build!(f32),
        cpal::SampleFormat::I16 => build!(i16),
        cpal::SampleFormat::U16 => build!(u16),
        cpal::SampleFormat::I32 => build!(i32),
        other => return Err(anyhow!("unsupported sample format {other:?}")),
    };
    stream.play().context("starting input stream")?;
    Ok((stream, rx, device_rate))
}

fn finish_samples(samples: Vec<f32>, device_rate: u32) -> Result<Vec<f32>> {
    let mut out = if device_rate == TARGET_RATE {
        samples
    } else {
        resample_to_16k(&samples, device_rate)?
    };
    if !out.is_empty() && out.len() < MIN_SAMPLES {
        out.resize(MIN_SAMPLES, 0.0);
    }
    Ok(out)
}

/// Resample mono f32 samples to 16 kHz (rubato FFT resampler, 1024-frame chunks).
pub fn resample_to_16k(samples: &[f32], from_rate: u32) -> Result<Vec<f32>> {
    if from_rate == TARGET_RATE || samples.is_empty() {
        return Ok(samples.to_vec());
    }
    const CHUNK: usize = 1024;
    let mut resampler = FftFixedIn::<f32>::new(from_rate as usize, TARGET_RATE as usize, CHUNK, 1, 1)
        .context("creating resampler")?;
    let mut out: Vec<f32> = Vec::with_capacity(
        (samples.len() as u64 * TARGET_RATE as u64 / from_rate as u64) as usize + CHUNK,
    );
    let mut pos = 0;
    let mut buf = vec![0.0f32; CHUNK];
    while pos < samples.len() {
        let take = CHUNK.min(samples.len() - pos);
        buf[..take].copy_from_slice(&samples[pos..pos + take]);
        buf[take..].fill(0.0); // zero-pad the final partial chunk
        let result = resampler
            .process(&[&buf[..]], None)
            .context("resampling chunk")?;
        out.extend_from_slice(&result[0]);
        pos += take;
    }
    Ok(out)
}

/// Enumerate input device names for the settings picker.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

/// Write 16 kHz mono samples as a WAV file (retained last recording, FR-5).
pub fn write_wav_16k_mono(path: &std::path::Path, samples: &[f32]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &s in samples {
        writer.write_sample(s)?;
    }
    writer.finalize()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_halves_sample_count_from_32k() {
        let samples: Vec<f32> = (0..32_000).map(|i| (i as f32 * 0.01).sin()).collect();
        let out = resample_to_16k(&samples, 32_000).unwrap();
        // 1 second of audio in, ~1 second out (chunk padding adds a tail).
        let expected = 16_000f32;
        assert!(
            (out.len() as f32 - expected).abs() / expected < 0.1,
            "got {} samples",
            out.len()
        );
    }

    #[test]
    fn resample_passthrough_at_16k() {
        let samples = vec![0.5f32; 1000];
        assert_eq!(resample_to_16k(&samples, 16_000).unwrap().len(), 1000);
    }

    #[test]
    fn wav_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.wav");
        let samples: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.02).sin() * 0.3).collect();
        write_wav_16k_mono(&path, &samples).unwrap();
        let back = crate::stt::read_wav_16k_mono(&path).unwrap();
        assert_eq!(back.len(), samples.len());
        assert!((back[100] - samples[100]).abs() < 1e-6);
    }
}
