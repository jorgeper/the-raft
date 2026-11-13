//! Transcription history (SPEC FR-5): last 20 transcripts persisted as JSON,
//! plus the audio of the last recording only (for Retry).

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

pub const HISTORY_CAP: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub text: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub model_id: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct HistoryStore {
    entries: VecDeque<HistoryEntry>,
}

impl HistoryStore {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    /// Push a new entry (newest first), evicting past HISTORY_CAP.
    pub fn push(&mut self, entry: HistoryEntry) {
        self.entries.push_front(entry);
        self.entries.truncate(HISTORY_CAP);
    }

    /// Replace the newest entry (used by Retry Last Transcription).
    pub fn replace_latest(&mut self, entry: HistoryEntry) {
        if !self.entries.is_empty() {
            self.entries[0] = entry;
        } else {
            self.entries.push_front(entry);
        }
    }

    /// Newest-first iteration order.
    pub fn list(&self) -> impl Iterator<Item = &HistoryEntry> {
        self.entries.iter()
    }

    pub fn latest(&self) -> Option<&HistoryEntry> {
        self.entries.front()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Where the last recording's audio is retained for Retry.
pub fn last_audio_path(data_dir: &Path) -> PathBuf {
    data_dir.join("last_recording.wav")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(text: &str) -> HistoryEntry {
        HistoryEntry {
            text: text.into(),
            timestamp: chrono::Utc::now(),
            model_id: "whisper-tiny".into(),
        }
    }

    // R6: ring buffer caps at 20, newest first, clear empties store.
    #[test]
    fn r6_caps_at_twenty() {
        let mut h = HistoryStore::default();
        for i in 0..30 {
            h.push(entry(&format!("t{i}")));
        }
        assert_eq!(h.len(), HISTORY_CAP);
        // Newest first: t29 down to t10.
        let texts: Vec<_> = h.list().map(|e| e.text.clone()).collect();
        assert_eq!(texts[0], "t29");
        assert_eq!(texts[19], "t10");
    }

    #[test]
    fn r6_newest_first_and_latest() {
        let mut h = HistoryStore::default();
        h.push(entry("first"));
        h.push(entry("second"));
        assert_eq!(h.latest().unwrap().text, "second");
        assert_eq!(
            h.list().map(|e| &e.text).collect::<Vec<_>>(),
            vec!["second", "first"]
        );
    }

    #[test]
    fn r6_clear_empties() {
        let mut h = HistoryStore::default();
        h.push(entry("a"));
        h.push(entry("b"));
        h.clear();
        assert!(h.is_empty());
        assert!(h.latest().is_none());
    }

    #[test]
    fn r6_replace_latest_for_retry() {
        let mut h = HistoryStore::default();
        h.push(entry("old"));
        h.push(entry("draft"));
        h.replace_latest(entry("retried"));
        assert_eq!(h.len(), 2);
        assert_eq!(h.latest().unwrap().text, "retried");
        // Replace on empty store inserts.
        let mut empty = HistoryStore::default();
        empty.replace_latest(entry("only"));
        assert_eq!(empty.len(), 1);
    }

    #[test]
    fn r6_persistence_roundtrip_and_corrupt_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let mut h = HistoryStore::default();
        h.push(entry("persisted"));
        h.save(&path).unwrap();
        let loaded = HistoryStore::load(&path);
        assert_eq!(loaded.latest().unwrap().text, "persisted");

        std::fs::write(&path, "garbage").unwrap();
        assert!(HistoryStore::load(&path).is_empty());
    }
}
