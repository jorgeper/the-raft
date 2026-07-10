//! Model download manager (SPEC FR-6.3): explicit state machine per model —
//! not_downloaded -> downloading (progress % + cancel) -> verifying -> downloaded.
//! Failures keep the .partial for resume; checksum mismatches delete the file.
//!
//! This and the user-initiated catalog fetch are the ONLY permitted network
//! code paths in the app (SPEC §1), plus the localhost-only enhancement client.

use crate::registry::{DownloadKind, ModelEntry};
use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

/// Event names shared with the frontend (and mirrored by the browser mock).
pub mod events {
    pub const PROGRESS: &str = "model-download-progress";
    pub const COMPLETE: &str = "model-download-complete";
    pub const CANCELLED: &str = "model-download-cancelled";
    pub const FAILED: &str = "model-download-failed";
    pub const VERIFYING: &str = "model-verification-started";
    pub const VERIFIED: &str = "model-verification-completed";
    pub const DELETED: &str = "model-deleted";
}

/// Tracks in-flight downloads so the UI can cancel them.
#[derive(Default)]
pub struct DownloadManager {
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Abstracts `AppHandle::emit` so the CLI and tests can run downloads headless.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

pub struct NullSink;
impl EventSink for NullSink {
    fn emit(&self, _event: &str, _payload: serde_json::Value) {}
}

impl DownloadManager {
    pub fn begin(&self, model_id: &str) -> Result<Arc<AtomicBool>> {
        let mut flags = self.cancel_flags.lock().unwrap();
        if flags.contains_key(model_id) {
            bail!("model '{model_id}' is already downloading");
        }
        let flag = Arc::new(AtomicBool::new(false));
        flags.insert(model_id.to_string(), flag.clone());
        Ok(flag)
    }

    pub fn finish(&self, model_id: &str) {
        self.cancel_flags.lock().unwrap().remove(model_id);
    }

    pub fn cancel(&self, model_id: &str) -> bool {
        if let Some(flag) = self.cancel_flags.lock().unwrap().get(model_id) {
            flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    pub fn is_downloading(&self, model_id: &str) -> bool {
        self.cancel_flags.lock().unwrap().contains_key(model_id)
    }
}

pub fn partial_path(entry: &ModelEntry, data_dir: &Path) -> PathBuf {
    entry.dir(data_dir).join(format!("{}.partial", entry.id))
}

pub fn partial_size(entry: &ModelEntry, data_dir: &Path) -> u64 {
    std::fs::metadata(partial_path(entry, data_dir))
        .map(|m| m.len())
        .unwrap_or(0)
}

/// Download, verify, and install a model. Blocking-async; call from a spawned task.
pub async fn download_model(
    entry: &ModelEntry,
    data_dir: &Path,
    sink: &dyn EventSink,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let partial = partial_path(entry, data_dir);
    std::fs::create_dir_all(entry.dir(data_dir))?;

    // Resume from an existing partial if present.
    let mut downloaded = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::Client::new();
    let mut request = client.get(&entry.url);
    if downloaded > 0 {
        request = request.header("Range", format!("bytes={downloaded}-"));
    }
    let response = request.send().await.context("starting download")?;
    let status = response.status();
    if downloaded > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
        // Server ignored the Range header; restart from scratch.
        std::fs::remove_file(&partial).ok();
        downloaded = 0;
    }
    if !status.is_success() {
        bail!("download failed: HTTP {status}");
    }
    let total = response
        .content_length()
        .map(|len| len + downloaded)
        .unwrap_or(entry.size_bytes);

    let mut file = tokio::task::block_in_place(|| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial)
    })
    .context("opening partial file")?;

    let mut stream = response.bytes_stream();
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            // Keep the partial for resume.
            sink.emit(events::CANCELLED, serde_json::json!(entry.id));
            return Ok(());
        }
        let chunk = chunk.context("reading download stream")?;
        use std::io::Write;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() >= 100 {
            last_emit = std::time::Instant::now();
            sink.emit(
                events::PROGRESS,
                serde_json::to_value(DownloadProgress {
                    model_id: entry.id.clone(),
                    downloaded,
                    total,
                    percentage: (downloaded as f64 / total.max(1) as f64) * 100.0,
                })
                .unwrap(),
            );
        }
    }
    drop(file);
    // Final progress tick so the UI lands on 100%.
    sink.emit(
        events::PROGRESS,
        serde_json::to_value(DownloadProgress {
            model_id: entry.id.clone(),
            downloaded,
            total: downloaded,
            percentage: 100.0,
        })
        .unwrap(),
    );

    // Verify checksum (SPEC FR-6.3); mismatch deletes the file.
    sink.emit(events::VERIFYING, serde_json::json!(entry.id));
    let sha = {
        let partial = partial.clone();
        tokio::task::spawn_blocking(move || sha256_file(&partial))
            .await
            .context("verification task")??
    };
    if sha != entry.sha256 {
        std::fs::remove_file(&partial).ok();
        sink.emit(
            events::FAILED,
            serde_json::json!({
                "model_id": entry.id,
                "error": format!("checksum mismatch (expected {}, got {sha}) — the download was corrupt and has been removed", entry.sha256),
            }),
        );
        bail!("checksum mismatch for {}", entry.id);
    }
    sink.emit(events::VERIFIED, serde_json::json!(entry.id));

    // Install: rename (file) or extract (archive).
    match entry.kind {
        DownloadKind::File => {
            let final_path = entry.engine_path(data_dir);
            std::fs::rename(&partial, &final_path)?;
        }
        DownloadKind::Archive => {
            let entry2 = entry.clone();
            let data_dir2 = data_dir.to_path_buf();
            let partial2 = partial.clone();
            tokio::task::spawn_blocking(move || extract_archive(&entry2, &data_dir2, &partial2))
                .await
                .context("extraction task")??;
            std::fs::remove_file(&partial).ok();
        }
    }
    sink.emit(events::COMPLETE, serde_json::json!(entry.id));
    Ok(())
}

/// Extract a tar.gz into the model dir. If the archive holds a single top-level
/// directory, that directory's contents become the model root (Handy-compatible
/// layout for the Parakeet archives).
fn extract_archive(entry: &ModelEntry, data_dir: &Path, archive_path: &Path) -> Result<()> {
    let model_dir = entry.dir(data_dir);
    let temp = model_dir.join(".extracting");
    if temp.exists() {
        std::fs::remove_dir_all(&temp)?;
    }
    std::fs::create_dir_all(&temp)?;

    let tar_gz = std::fs::File::open(archive_path).context("opening archive")?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(tar_gz));
    archive.unpack(&temp).map_err(|e| {
        let _ = std::fs::remove_dir_all(&temp);
        let _ = std::fs::remove_file(archive_path); // corrupt archive: restart next time
        anyhow!("extracting archive: {e}")
    })?;

    // Locate the extracted model root.
    let top_entries: Vec<_> = std::fs::read_dir(&temp)?
        .filter_map(|e| e.ok())
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .collect();
    let source = if top_entries.len() == 1 && top_entries[0].file_type()?.is_dir() {
        top_entries[0].path()
    } else {
        temp.clone()
    };

    // Move contents into the model dir root (engine_path with filename "").
    for item in std::fs::read_dir(&source)? {
        let item = item?;
        let dest = model_dir.join(item.file_name());
        if dest.exists() {
            if dest.is_dir() {
                std::fs::remove_dir_all(&dest)?;
            } else {
                std::fs::remove_file(&dest)?;
            }
        }
        std::fs::rename(item.path(), dest)?;
    }
    std::fs::remove_dir_all(&temp).ok();
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).context("opening file for checksum")?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn delete_model(entry: &ModelEntry, data_dir: &Path) -> Result<()> {
    let dir = entry.dir(data_dir);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_of_known_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f");
        std::fs::write(&path, b"hello world").unwrap();
        assert_eq!(
            sha256_file(&path).unwrap(),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn cancel_flags_lifecycle() {
        let dm = DownloadManager::default();
        assert!(!dm.is_downloading("m"));
        assert!(!dm.cancel("m"));
        let flag = dm.begin("m").unwrap();
        assert!(dm.is_downloading("m"));
        assert!(dm.begin("m").is_err(), "double download rejected");
        assert!(dm.cancel("m"));
        assert!(flag.load(Ordering::SeqCst));
        dm.finish("m");
        assert!(!dm.is_downloading("m"));
    }
}
