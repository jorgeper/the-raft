//! Conversation document model and `.mnote` container (spec §4).

use anyhow::{Context, Result};
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;

pub const SPEAKER_PALETTE: [&str; 8] = [
    "#5B8DEF", "#E0716C", "#5BBD8B", "#C99A3C", "#9B7FE0", "#4FB3C6", "#D77BAE", "#8A9663",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineChoice {
    pub engine: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub stt: EngineChoice,
    pub diarization: EngineChoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Speaker {
    pub id: String,
    pub name: String,
    pub color: String,
    pub auto_named: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Item {
    Utterance {
        id: String,
        speaker_id: String,
        text: String,
        t_start: f64,
        t_end: f64,
        wall_time: DateTime<Local>,
    },
    Image {
        id: String,
        file: String,
        wall_time: DateTime<Local>,
        caption: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub started_at: Option<DateTime<Local>>,
    pub ended_at: Option<DateTime<Local>>,
    pub engine: EngineInfo,
    pub speakers: Vec<Speaker>,
    pub items: Vec<Item>,
}

impl Conversation {
    pub fn new_recording(stt_model: &str) -> Self {
        Conversation {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            title: "Untitled conversation".into(),
            started_at: Some(Local::now()),
            ended_at: None,
            engine: EngineInfo {
                stt: EngineChoice { engine: "whisper.cpp".into(), model: stt_model.into() },
                // Real diarization arrives in M2.
                diarization: EngineChoice { engine: "none".into(), model: "none".into() },
            },
            speakers: vec![Speaker {
                id: "spk-1".into(),
                name: "Speaker 1".into(),
                color: SPEAKER_PALETTE[0].into(),
                auto_named: false,
                embedding: None,
            }],
            items: Vec::new(),
        }
    }
}

pub fn write_mnote(path: &Path, conv: &Conversation, audio_ogg: Option<&[u8]>) -> Result<()> {
    let file = std::fs::File::create(path)
        .with_context(|| format!("creating {}", path.display()))?;
    let mut zw = zip::ZipWriter::new(file);

    let json_opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zw.start_file("conversation.json", json_opts)?;
    zw.write_all(serde_json::to_string_pretty(conv)?.as_bytes())?;

    if let Some(ogg) = audio_ogg {
        // Opus is already compressed; store it raw.
        let store_opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .large_file(ogg.len() as u64 >= 0xFFFF_FFFF);
        zw.start_file("audio.ogg", store_opts)?;
        zw.write_all(ogg)?;
    }

    zw.finish()?;
    Ok(())
}

pub fn read_mnote(path: &Path) -> Result<Conversation> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("opening {}", path.display()))?;
    let mut za = zip::ZipArchive::new(file)?;
    let mut entry = za
        .by_name("conversation.json")
        .context("no conversation.json in .mnote")?;
    let mut json = String::new();
    entry.read_to_string(&mut json)?;
    Ok(serde_json::from_str(&json)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mnote_round_trip() {
        let mut c = Conversation::new_recording("small");
        c.title = "Standup".into();
        c.items.push(Item::Utterance {
            id: "utt-0001".into(),
            speaker_id: c.speakers[0].id.clone(),
            text: "hello world".into(),
            t_start: 1.0,
            t_end: 2.5,
            wall_time: chrono::Local::now(),
        });
        let dir = std::env::temp_dir().join(format!("mnote-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.mnote");
        write_mnote(&path, &c, Some(b"OggS-fake")).unwrap();
        let back = read_mnote(&path).unwrap();
        assert_eq!(back.title, "Standup");
        assert_eq!(back.schema_version, 1);
        assert_eq!(back.items.len(), 1);
        match &back.items[0] {
            Item::Utterance { text, .. } => assert_eq!(text, "hello world"),
            _ => panic!("expected utterance"),
        }
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"type\":\"utterance\""));
        assert!(json.contains("\"t_start\":"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
