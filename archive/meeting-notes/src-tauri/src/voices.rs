//! Opt-in persistent voice library (spec §5.3). Nothing is stored unless the
//! user clicks "Remember this voice"; entries are deletable in Settings.

use anyhow::{Context, Result};
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Conservative match threshold for auto-naming returning voices — higher
/// than the in-meeting clustering threshold on purpose (false names are
/// worse than missed names).
pub const MATCH_THRESHOLD: f32 = 0.70;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEntry {
    pub id: String,
    pub name: String,
    pub embedding: Vec<f32>,
    pub created_at: DateTime<Local>,
    pub source_conversation: String,
}

pub fn voices_path() -> PathBuf {
    crate::paths::data_root().join("voices.json")
}

pub fn load() -> Vec<VoiceEntry> {
    std::fs::read_to_string(voices_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(entries: &[VoiceEntry]) -> Result<()> {
    let path = voices_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(entries)?)
        .with_context(|| format!("writing {}", path.display()))
}

pub fn remember(
    name: &str,
    embedding: Vec<f32>,
    source_conversation: &str,
) -> Result<VoiceEntry> {
    let mut entries = load();
    // Re-remembering a name replaces the old print instead of duplicating it.
    entries.retain(|e| e.name != name);
    let entry = VoiceEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        embedding,
        created_at: Local::now(),
        source_conversation: source_conversation.to_string(),
    };
    entries.push(entry.clone());
    save(&entries)?;
    Ok(entry)
}

pub fn forget(voice_id: &str) -> Result<()> {
    let mut entries = load();
    let before = entries.len();
    entries.retain(|e| e.id != voice_id);
    anyhow::ensure!(entries.len() < before, "unknown voice id");
    save(&entries)
}

/// Best library match for an embedding, if any clears the threshold.
pub fn best_match<'a>(entries: &'a [VoiceEntry], embedding: &[f32]) -> Option<&'a VoiceEntry> {
    entries
        .iter()
        .map(|e| (e, cosine(&e.embedding, embedding)))
        .filter(|(_, sim)| *sim >= MATCH_THRESHOLD)
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(e, _)| e)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na * nb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remember_forget_round_trip() {
        let dir = std::env::temp_dir().join(format!("minutes-voices-{}", std::process::id()));
        std::env::set_var("MINUTES_DATA_DIR", &dir);

        let e = remember("Testy", vec![1.0, 0.0, 0.0], "conv-1").unwrap();
        assert_eq!(load().len(), 1);

        // Re-remembering the same name replaces, not duplicates.
        remember("Testy", vec![0.0, 1.0, 0.0], "conv-2").unwrap();
        let entries = load();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_conversation, "conv-2");

        // Matching honors the threshold.
        assert!(best_match(&entries, &[0.0, 1.0, 0.0]).is_some());
        assert!(best_match(&entries, &[1.0, 0.0, 0.0]).is_none());

        assert!(forget(&e.id).is_err()); // replaced entry's old id is gone
        forget(&entries[0].id).unwrap();
        assert!(load().is_empty());

        std::fs::remove_dir_all(&dir).ok();
        std::env::remove_var("MINUTES_DATA_DIR");
    }
}
