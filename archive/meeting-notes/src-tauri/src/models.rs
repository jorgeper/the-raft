//! Model catalog + downloader. This module is the app's ONLY network code
//! (spec §3.2) and runs solely on explicit user action from OOBE/Settings.

use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Transcription,
    Diarization,
}

pub struct CatalogEntry {
    pub name: &'static str,
    pub kind: ModelKind,
    pub label: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,
    pub url: &'static str,
    /// one-line speed/quality hint shown in OOBE
    pub hint: &'static str,
}

// Hashes pinned 2026-07-12 from the Hugging Face LFS API (whisper) and a
// verified local download (embedding).
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        name: "tiny",
        kind: ModelKind::Transcription,
        label: "Whisper tiny",
        size_bytes: 77_691_713,
        sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        hint: "fastest, lowest quality",
    },
    CatalogEntry {
        name: "base",
        kind: ModelKind::Transcription,
        label: "Whisper base",
        size_bytes: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        hint: "quick, fine for clear speech",
    },
    CatalogEntry {
        name: "small",
        kind: ModelKind::Transcription,
        label: "Whisper small",
        size_bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        hint: "recommended — best realtime balance",
    },
    CatalogEntry {
        name: "large-v3-turbo",
        kind: ModelKind::Transcription,
        label: "Whisper large v3 turbo",
        size_bytes: 1_624_555_275,
        sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        hint: "best quality, needs a strong machine",
    },
    CatalogEntry {
        name: "embedding",
        kind: ModelKind::Diarization,
        label: "Speaker embedding (CAM++)",
        size_bytes: 29_292_684,
        sha256: "c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM%2B%2B.onnx",
        hint: "required for speaker labels",
    },
];

pub fn entry(name: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|e| e.name == name)
}

pub fn installed_path(e: &CatalogEntry) -> PathBuf {
    match e.kind {
        ModelKind::Transcription => crate::stt::model_path(e.name),
        ModelKind::Diarization => crate::diar::embedding_model_path(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub name: String,
    pub kind: ModelKind,
    pub label: String,
    pub size_bytes: u64,
    pub hint: String,
    pub installed: bool,
    pub active: bool,
}

pub fn list(active_stt: &str) -> Vec<ModelInfo> {
    CATALOG
        .iter()
        .map(|e| ModelInfo {
            name: e.name.into(),
            kind: e.kind,
            label: e.label.into(),
            size_bytes: e.size_bytes,
            hint: e.hint.into(),
            installed: installed_path(e).exists(),
            active: match e.kind {
                ModelKind::Transcription => e.name == active_stt,
                ModelKind::Diarization => true,
            },
        })
        .collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Streaming download → `.part` → sha256 verify → rename into place.
/// `progress(downloaded, total)` fires roughly every 512 KiB.
pub fn download(name: &str, mut progress: impl FnMut(u64, u64)) -> Result<()> {
    let e = entry(name).with_context(|| format!("unknown model {name}"))?;
    let dest = installed_path(e);
    if dest.exists() {
        return Ok(());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let part = dest.with_extension("part");

    let resp = ureq::get(e.url).call().context("download request failed")?;
    let total = e.size_bytes;
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&part)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 512 * 1024];
    let mut downloaded = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        downloaded += n as u64;
        progress(downloaded, total);
    }
    file.flush()?;
    drop(file);

    let got = hex::encode(hasher.finalize());
    if got != e.sha256 {
        std::fs::remove_file(&part).ok();
        anyhow::bail!("sha256 mismatch for {name}: expected {}, got {got}", e.sha256);
    }
    std::fs::rename(&part, &dest)?;
    Ok(())
}

pub fn delete(name: &str) -> Result<()> {
    let e = entry(name).with_context(|| format!("unknown model {name}"))?;
    std::fs::remove_file(installed_path(e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_well_formed() {
        let mut names = std::collections::HashSet::new();
        for e in CATALOG {
            assert!(names.insert(e.name), "duplicate model name {}", e.name);
            assert_eq!(e.sha256.len(), 64, "{} sha256 not 64 hex chars", e.name);
            assert!(e.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(e.url.starts_with("https://"));
            assert!(e.size_bytes > 1_000_000);
        }
        assert!(entry("small").is_some());
        assert!(entry("embedding").is_some());
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // SHA-256("abc")
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
