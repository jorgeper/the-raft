//! Speaker diarization: per-utterance embeddings (sherpa-onnx) + online
//! cosine-similarity clustering (spec §2.1, §5.1).

use crate::audio::SAMPLE_RATE;
use crate::stt::models_dir;
use anyhow::{Context, Result};
use sherpa_rs::speaker_id::{EmbeddingExtractor, ExtractorConfig};
use std::path::PathBuf;

/// Cosine similarity at or above which an utterance joins an existing cluster.
/// Measured on the `say`-voice fixtures (CAM++ voxceleb embeddings): same
/// voice 0.92–0.94, cross-voice 0.56–0.62 — TTS voices from one engine sit
/// closer together than real humans, so real-voice tuning may lower this.
pub const SIM_THRESHOLD: f32 = 0.65;

pub fn embedding_model_path() -> PathBuf {
    models_dir().join("speaker-embedding.onnx")
}

struct Cluster {
    centroid: Vec<f32>,
    count: usize,
}

pub struct Diarizer {
    extractor: EmbeddingExtractor,
    clusters: Vec<Cluster>,
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na * nb)
}

impl Diarizer {
    pub fn load() -> Result<Self> {
        let path = embedding_model_path();
        anyhow::ensure!(
            path.exists(),
            "speaker embedding model missing: {} (run scripts/fetch-models.sh embedding)",
            path.display()
        );
        let extractor = EmbeddingExtractor::new(ExtractorConfig {
            model: path.to_string_lossy().into_owned(),
            ..Default::default()
        })
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("loading speaker embedding model")?;
        Ok(Diarizer { extractor, clusters: Vec::new() })
    }

    /// Assign an utterance to a speaker; returns the 0-based speaker index.
    /// Creates a new cluster when nothing is similar enough.
    pub fn assign(&mut self, samples_16k: &[f32]) -> Result<usize> {
        let emb = self
            .extractor
            .compute_speaker_embedding(samples_16k.to_vec(), SAMPLE_RATE)
            .map_err(|e| anyhow::anyhow!("{e}"))?;

        let best = self
            .clusters
            .iter()
            .enumerate()
            .map(|(i, c)| (i, cosine(&emb, &c.centroid)))
            .max_by(|a, b| a.1.total_cmp(&b.1));

        match best {
            Some((idx, sim)) if sim >= SIM_THRESHOLD => {
                let c = &mut self.clusters[idx];
                // Running mean keeps the centroid stable as evidence accrues.
                let n = c.count as f32;
                for (cv, ev) in c.centroid.iter_mut().zip(&emb) {
                    *cv = (*cv * n + ev) / (n + 1.0);
                }
                c.count += 1;
                Ok(idx)
            }
            _ => {
                self.clusters.push(Cluster { centroid: emb, count: 1 });
                Ok(self.clusters.len() - 1)
            }
        }
    }

    pub fn speaker_count(&self) -> usize {
        self.clusters.len()
    }

    /// Centroid of a cluster (for M5 voice memory).
    pub fn centroid(&self, idx: usize) -> Option<&[f32]> {
        self.clusters.get(idx).map(|c| c.centroid.as_slice())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::load_wav_16k_mono;
    use std::path::Path;

    fn fx(name: &str) -> Vec<f32> {
        load_wav_16k_mono(Path::new(&format!("tests/fixtures/{name}.wav"))).unwrap()
    }

    fn ready() -> bool {
        if embedding_model_path().exists() {
            true
        } else {
            eprintln!("SKIP: embedding model missing, run scripts/fetch-models.sh embedding");
            false
        }
    }

    #[test]
    fn same_voice_same_cluster() {
        if !ready() {
            return;
        }
        let mut d = Diarizer::load().unwrap();
        let a = d.assign(&fx("alice-1")).unwrap();
        let b = d.assign(&fx("alice-2")).unwrap();
        assert_eq!(a, b);
        assert_eq!(d.speaker_count(), 1);
    }

    #[test]
    fn different_voices_different_clusters() {
        if !ready() {
            return;
        }
        let mut d = Diarizer::load().unwrap();
        let a = d.assign(&fx("alice-1")).unwrap();
        let b = d.assign(&fx("bob-1")).unwrap();
        assert_ne!(a, b);
        assert_eq!(d.speaker_count(), 2);
    }

    #[test]
    fn alternating_conversation_two_clusters() {
        if !ready() {
            return;
        }
        let mut d = Diarizer::load().unwrap();
        let seq = [
            d.assign(&fx("alice-1")).unwrap(),
            d.assign(&fx("bob-1")).unwrap(),
            d.assign(&fx("alice-2")).unwrap(),
            d.assign(&fx("bob-2")).unwrap(),
        ];
        assert_eq!(seq, [0, 1, 0, 1], "expected alternating speakers, got {seq:?}");
        assert_eq!(d.speaker_count(), 2);
    }
}

#[cfg(test)]
mod simdebug {
    use super::*;
    use crate::audio::load_wav_16k_mono;
    use std::path::Path;

    #[test]
    #[ignore]
    fn print_similarity_matrix() {
        let names = ["alice-1", "alice-2", "bob-1", "bob-2"];
        let mut d = Diarizer::load().unwrap();
        let embs: Vec<Vec<f32>> = names
            .iter()
            .map(|n| {
                let s = load_wav_16k_mono(Path::new(&format!("tests/fixtures/{n}.wav"))).unwrap();
                d.extractor
                    .compute_speaker_embedding(s, crate::audio::SAMPLE_RATE)
                    .unwrap()
            })
            .collect();
        for i in 0..names.len() {
            for j in (i + 1)..names.len() {
                eprintln!("{} vs {}: {:.3}", names[i], names[j], cosine(&embs[i], &embs[j]));
            }
        }
    }
}
