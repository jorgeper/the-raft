//! Persistent app settings: `~/Library/Application Support/mail-archive/config.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Debug)]
pub struct Config {
    pub library_path: Option<PathBuf>,
}

/// Where the config file lives (next to the default library directory).
pub fn config_path() -> PathBuf {
    mail_core::paths::default_library_dir()
        .parent()
        .map(|p| p.join("config.json"))
        .unwrap_or_else(|| PathBuf::from("config.json"))
}

impl Config {
    /// Read the config; a missing or unreadable file yields the default.
    pub fn load_from(path: &Path) -> Config {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save_to(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            mail_core::paths::create_private_dir(dir)?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        // Write-then-rename so a crash never leaves a half-written file.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_default() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub/config.json");
        assert_eq!(Config::load_from(&p), Config::default());

        let c = Config {
            library_path: Some(PathBuf::from("/tmp/some lib")),
        };
        c.save_to(&p).unwrap();
        assert_eq!(Config::load_from(&p), c);

        std::fs::write(&p, b"not json").unwrap();
        assert_eq!(Config::load_from(&p), Config::default());
    }
}
