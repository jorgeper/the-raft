//! Silero-VAD-based utterance segmenter (spec §2.1: ≥600 ms silence ends an
//! utterance, force-split at 30 s).

use crate::audio::{CHUNK, SAMPLE_RATE};
use anyhow::Result;
use std::collections::VecDeque;
use voice_activity_detector::VoiceActivityDetector;

pub const SILENCE_END_MS: u64 = 600;
pub const MAX_UTTERANCE_S: u64 = 30;
const SPEECH_THRESHOLD: f32 = 0.5;
/// Utterances with less than this much detected speech are dropped (coughs, clicks).
const MIN_SPEECH_MS: u64 = 300;
/// Audio retained before the first speech frame so word onsets survive.
const PRE_ROLL_MS: u64 = 150;

const FRAME_MS: u64 = (CHUNK as u64 * 1000) / SAMPLE_RATE as u64; // 32 ms
const SILENCE_END_FRAMES: u32 = (SILENCE_END_MS / FRAME_MS) as u32;
const MIN_SPEECH_FRAMES: u32 = (MIN_SPEECH_MS / FRAME_MS) as u32;
const PRE_ROLL_FRAMES: usize = (PRE_ROLL_MS / FRAME_MS) as usize + 1;
const MAX_UTTERANCE_SAMPLES: usize = (MAX_UTTERANCE_S as usize) * SAMPLE_RATE as usize;

#[derive(Debug, Clone)]
pub struct Utterance {
    pub samples: Vec<f32>,
    /// Seconds of consumed (non-paused) stream position.
    pub t_start: f64,
    pub t_end: f64,
}

pub struct Segmenter {
    vad: VoiceActivityDetector,
    pending: Vec<f32>,
    pre_roll: VecDeque<Vec<f32>>,
    current: Option<Current>,
    consumed_samples: u64,
}

struct Current {
    samples: Vec<f32>,
    start_sample: u64,
    silence_run: u32,
    speech_frames: u32,
}

impl Segmenter {
    pub fn new() -> Result<Self> {
        let vad = VoiceActivityDetector::builder()
            .sample_rate(SAMPLE_RATE as i64)
            .chunk_size(CHUNK)
            .build()?;
        Ok(Segmenter {
            vad,
            pending: Vec::new(),
            pre_roll: VecDeque::new(),
            current: None,
            consumed_samples: 0,
        })
    }

    /// Feed samples; returns any utterances closed by this batch.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Utterance> {
        let mut closed = Vec::new();
        self.pending.extend_from_slice(samples);
        while self.pending.len() >= CHUNK {
            let frame: Vec<f32> = self.pending.drain(..CHUNK).collect();
            if let Some(u) = self.process_frame(frame) {
                closed.push(u);
            }
        }
        closed
    }

    /// End of stream: close any open utterance.
    pub fn flush(&mut self) -> Option<Utterance> {
        self.close_current()
    }

    /// Samples-so-far of the open utterance (for partial transcription).
    pub fn open_snapshot(&self) -> Option<(Vec<f32>, f64)> {
        self.current.as_ref().map(|c| {
            (c.samples.clone(), c.start_sample as f64 / SAMPLE_RATE as f64)
        })
    }

    fn process_frame(&mut self, frame: Vec<f32>) -> Option<Utterance> {
        let prob = self.vad.predict(frame.iter().copied());
        let is_speech = prob > SPEECH_THRESHOLD;
        let frame_start = self.consumed_samples;
        self.consumed_samples += frame.len() as u64;

        let mut result = None;
        match (&mut self.current, is_speech) {
            (None, true) => {
                // Open a new utterance, prefixed with pre-roll history.
                let pre: Vec<f32> = self.pre_roll.iter().flatten().copied().collect();
                let start = frame_start.saturating_sub(pre.len() as u64);
                let mut samples = pre;
                samples.extend_from_slice(&frame);
                self.current = Some(Current {
                    samples,
                    start_sample: start,
                    silence_run: 0,
                    speech_frames: 1,
                });
            }
            (None, false) => {}
            (Some(cur), speech) => {
                cur.samples.extend_from_slice(&frame);
                if speech {
                    cur.speech_frames += 1;
                    cur.silence_run = 0;
                } else {
                    cur.silence_run += 1;
                }
                if cur.silence_run >= SILENCE_END_FRAMES
                    || cur.samples.len() >= MAX_UTTERANCE_SAMPLES
                {
                    result = self.close_current();
                }
            }
        }

        self.pre_roll.push_back(frame);
        while self.pre_roll.len() > PRE_ROLL_FRAMES {
            self.pre_roll.pop_front();
        }
        result
    }

    fn close_current(&mut self) -> Option<Utterance> {
        let cur = self.current.take()?;
        if cur.speech_frames < MIN_SPEECH_FRAMES {
            return None;
        }
        // Trim the trailing silence run off the samples.
        let trailing = (cur.silence_run as usize).saturating_sub(1) * CHUNK;
        let keep = cur.samples.len().saturating_sub(trailing);
        let samples = cur.samples[..keep].to_vec();
        let t_start = cur.start_sample as f64 / SAMPLE_RATE as f64;
        let t_end = (cur.start_sample as usize + samples.len()) as f64 / SAMPLE_RATE as f64;
        Some(Utterance { samples, t_start, t_end })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::load_wav_16k_mono;

    #[test]
    fn silence_yields_no_utterances() {
        let mut seg = Segmenter::new().unwrap();
        let mut out = seg.push(&vec![0.0f32; 16000 * 5]);
        if let Some(u) = seg.flush() {
            out.push(u);
        }
        assert!(out.is_empty(), "got {} utterances from silence", out.len());
    }

    #[test]
    fn speech_fixture_yields_utterance_with_sane_times() {
        let audio = load_wav_16k_mono(std::path::Path::new("tests/fixtures/hello.wav")).unwrap();
        let mut seg = Segmenter::new().unwrap();
        let mut out = seg.push(&audio);
        if let Some(u) = seg.flush() {
            out.push(u);
        }
        assert!(!out.is_empty(), "spoken fixture must produce at least one utterance");
        let u = &out[0];
        assert!(u.t_end > u.t_start);
        assert!(u.samples.len() as f64 / 16000.0 > 0.5);
    }

    #[test]
    fn pause_splits_two_utterances() {
        let audio =
            load_wav_16k_mono(std::path::Path::new("tests/fixtures/twoparts.wav")).unwrap();
        let mut seg = Segmenter::new().unwrap();
        let mut out = seg.push(&audio);
        if let Some(u) = seg.flush() {
            out.push(u);
        }
        assert!(out.len() >= 2, "900ms pause must split utterances, got {}", out.len());
    }
}
