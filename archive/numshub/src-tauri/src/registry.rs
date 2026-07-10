//! Data-driven model registry (SPEC §3). One JSON entry fully defines a model;
//! the UI renders whatever this registry contains. Adding a model = adding an
//! entry to `models.json`.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Embedded catalog. Kept as JSON (not Rust consts) so an entry is the only
/// thing needed to add a model.
pub const EMBEDDED_CATALOG: &str = include_str!("../models.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineFamily {
    /// GGUF/ggml models run through whisper.cpp (transcribe-cpp).
    Whisper,
    /// ONNX models (Parakeet) run through transcribe-rs.
    Parakeet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadKind {
    /// Single model file stored as `<data_dir>/models/<id>/<filename>`.
    File,
    /// tar.gz archive extracted into `<data_dir>/models/<id>/`.
    Archive,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    pub display_name: String,
    pub engine: EngineFamily,
    pub url: String,
    /// SHA-256 of the downloaded artifact (the archive itself for Archive kind).
    pub sha256: String,
    pub size_bytes: u64,
    pub languages: String,
    pub description: String,
    #[serde(default)]
    pub recommended: bool,
    pub kind: DownloadKind,
    /// Filename to store (File kind) or the directory member holding the model
    /// root after extraction (Archive kind, "" = archive root).
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub models: Vec<ModelEntry>,
}

impl Registry {
    pub fn embedded() -> Result<Self> {
        Self::from_json(EMBEDDED_CATALOG)
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let reg: Registry = serde_json::from_str(json).context("parsing model registry")?;
        reg.validate()?;
        Ok(reg)
    }

    fn validate(&self) -> Result<()> {
        if self.models.is_empty() {
            bail!("model registry is empty");
        }
        let mut seen = std::collections::HashSet::new();
        for m in &self.models {
            for (field, value) in [
                ("id", &m.id),
                ("display_name", &m.display_name),
                ("url", &m.url),
                ("sha256", &m.sha256),
                ("languages", &m.languages),
            ] {
                if value.trim().is_empty() {
                    bail!("model entry '{}' has empty {field}", m.id);
                }
            }
            if m.sha256.len() != 64 || !m.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
                bail!("model '{}' sha256 is not a hex sha-256", m.id);
            }
            if m.size_bytes == 0 {
                bail!("model '{}' has zero size", m.id);
            }
            if !m.url.starts_with("https://") {
                bail!("model '{}' url must be https", m.id);
            }
            if !seen.insert(m.id.clone()) {
                bail!("duplicate model id '{}'", m.id);
            }
        }
        let recommended = self.models.iter().filter(|m| m.recommended).count();
        if recommended != 1 {
            bail!("registry must flag exactly one recommended model, found {recommended}");
        }
        Ok(())
    }

    /// The listing API the UI consumes (settings Models section).
    pub fn list(&self) -> &[ModelEntry] {
        &self.models
    }

    pub fn get(&self, id: &str) -> Option<&ModelEntry> {
        self.models.iter().find(|m| m.id == id)
    }

    pub fn recommended(&self) -> &ModelEntry {
        // validate() guarantees exactly one.
        self.models.iter().find(|m| m.recommended).unwrap()
    }
}

impl ModelEntry {
    /// Directory holding this model's artifacts.
    pub fn dir(&self, data_dir: &Path) -> PathBuf {
        data_dir.join("models").join(&self.id)
    }

    /// Path handed to the engine: the model file (File) or model root dir (Archive).
    pub fn engine_path(&self, data_dir: &Path) -> PathBuf {
        match self.kind {
            DownloadKind::File => self.dir(data_dir).join(&self.filename),
            DownloadKind::Archive => {
                if self.filename.is_empty() {
                    self.dir(data_dir)
                } else {
                    self.dir(data_dir).join(&self.filename)
                }
            }
        }
    }

    pub fn is_downloaded(&self, data_dir: &Path) -> bool {
        self.engine_path(data_dir).exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // R7: registry parses, fields present, exactly one recommended, paths resolve,
    // synthetic entries surface through the listing API.
    #[test]
    fn r7_embedded_registry_parses_and_validates() {
        let reg = Registry::embedded().expect("embedded models.json must be valid");
        assert!(reg.list().len() >= 4, "catalog should have at least 4 models");
        for m in reg.list() {
            assert!(!m.id.is_empty());
            assert!(!m.url.is_empty());
            assert_eq!(m.sha256.len(), 64, "{} sha256", m.id);
            assert!(m.size_bytes > 0, "{} size", m.id);
        }
    }

    #[test]
    fn r7_exactly_one_recommended_and_it_is_parakeet() {
        let reg = Registry::embedded().unwrap();
        let rec: Vec<_> = reg.list().iter().filter(|m| m.recommended).collect();
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0].engine, EngineFamily::Parakeet);
        assert_eq!(reg.recommended().id, rec[0].id);
    }

    #[test]
    fn r7_path_resolution() {
        let reg = Registry::embedded().unwrap();
        let data = Path::new("/tmp/numshub-data");
        for m in reg.list() {
            let p = m.engine_path(data);
            assert!(
                p.starts_with(data.join("models").join(&m.id)),
                "{} resolves inside its model dir: {p:?}",
                m.id
            );
        }
    }

    #[test]
    fn r7_synthetic_entry_surfaces_through_listing_api() {
        // Proves extensibility: a new registry entry is all a new model needs.
        let mut json: serde_json::Value = serde_json::from_str(EMBEDDED_CATALOG).unwrap();
        json["models"].as_array_mut().unwrap().push(serde_json::json!({
            "id": "test-model-9000",
            "display_name": "Test Model 9000",
            "engine": "whisper",
            "url": "https://example.com/model.bin",
            "sha256": "a".repeat(64),
            "size_bytes": 1234,
            "languages": "Testish",
            "description": "synthetic",
            "recommended": false,
            "kind": "file",
            "filename": "model.bin"
        }));
        let reg = Registry::from_json(&json.to_string()).unwrap();
        let found = reg.get("test-model-9000").expect("listed");
        assert_eq!(found.display_name, "Test Model 9000");
        assert!(reg.list().iter().any(|m| m.id == "test-model-9000"));
    }

    #[test]
    fn r7_invalid_registries_rejected() {
        // Empty sha
        let bad = r#"{"models":[{"id":"x","display_name":"X","engine":"whisper",
            "url":"https://e.com/f","sha256":"","size_bytes":1,"languages":"en",
            "description":"d","recommended":true,"kind":"file","filename":"f"}]}"#;
        assert!(Registry::from_json(bad).is_err());
        // Two recommended
        let mut json: serde_json::Value = serde_json::from_str(EMBEDDED_CATALOG).unwrap();
        for m in json["models"].as_array_mut().unwrap().iter_mut() {
            m["recommended"] = serde_json::json!(true);
        }
        assert!(Registry::from_json(&json.to_string()).is_err());
        // Non-https URL
        let mut json: serde_json::Value = serde_json::from_str(EMBEDDED_CATALOG).unwrap();
        json["models"][0]["url"] = serde_json::json!("http://insecure.com/m.bin");
        assert!(Registry::from_json(&json.to_string()).is_err());
    }
}
