//! Default paths, cloud-sync detection and private (0700/0600) file creation.

use std::fs::{DirBuilder, File, OpenOptions};
use std::io;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// `$HOME/Library/Application Support/mail-archive/library`.
pub fn default_library_dir() -> PathBuf {
    home_dir().join("Library/Application Support/mail-archive/library")
}

/// A short user-facing warning if `p` lies inside a cloud-synced folder.
pub fn cloud_sync_warning(p: &Path) -> Option<&'static str> {
    cloud_sync_warning_in(p, &home_dir())
}

/// Canonicalize `p`; if it does not exist yet, canonicalize its nearest
/// existing ancestor and re-append the missing tail.
fn resolve(p: &Path) -> PathBuf {
    let mut tail = Vec::new();
    let mut cur = p;
    loop {
        if let Ok(c) = cur.canonicalize() {
            return tail.iter().rev().fold(c, |acc, n| acc.join(n));
        }
        match (cur.parent(), cur.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name);
                cur = parent;
            }
            _ => return p.to_path_buf(),
        }
    }
}

pub(crate) fn cloud_sync_warning_in(p: &Path, home: &Path) -> Option<&'static str> {
    // Check the path as given (e.g. `~/dropbox/..`) and with symlinks resolved.
    let real_home = resolve(home);
    classify(p, home)
        .or_else(|| classify(p, &real_home))
        .or_else(|| classify(&resolve(p), &real_home))
}

fn classify(p: &Path, home: &Path) -> Option<&'static str> {
    let rel = p.strip_prefix(home).ok()?;
    let mut c = rel.components().map(|c| c.as_os_str().to_string_lossy());
    let first = c.next()?.to_ascii_lowercase();
    let second = c.next().map(|s| s.to_ascii_lowercase());
    match (first.as_str(), second.as_deref()) {
        ("library", Some("cloudstorage")) => {
            let provider = c.next().unwrap_or_default().to_ascii_lowercase();
            Some(if provider.starts_with("dropbox") {
                DROPBOX
            } else if provider.starts_with("onedrive") {
                ONEDRIVE
            } else if provider.starts_with("googledrive") {
                GOOGLE
            } else {
                GENERIC
            })
        }
        ("library", Some("mobile documents")) => Some(ICLOUD),
        ("dropbox", _) => Some(DROPBOX),
        ("google drive", _) => Some(GOOGLE),
        ("onedrive", _) => Some(ONEDRIVE),
        _ => None,
    }
}

const DROPBOX: &str = "This folder is synced by Dropbox; keeping the library there uploads your mail to the cloud and can corrupt the index.";
const ICLOUD: &str = "This folder is synced by iCloud Drive; keeping the library there uploads your mail to the cloud and can corrupt the index.";
const GOOGLE: &str = "This folder is synced by Google Drive; keeping the library there uploads your mail to the cloud and can corrupt the index.";
const ONEDRIVE: &str = "This folder is synced by OneDrive; keeping the library there uploads your mail to the cloud and can corrupt the index.";
const GENERIC: &str = "This folder is synced by a cloud storage service; keeping the library there uploads your mail to the cloud and can corrupt the index.";

/// Create `p` and any missing parents with mode 0700.
pub fn create_private_dir(p: &Path) -> io::Result<()> {
    DirBuilder::new().recursive(true).mode(0o700).create(p)
}

/// Open `p` for writing, creating it with mode 0600 if missing. Existing
/// contents are kept (not truncated); writes go where the cursor is.
pub fn create_private_file(p: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn cloud_paths_warned() {
        let home = Path::new("/Users/u");
        for p in [
            "Library/CloudStorage/Dropbox-x/a",
            "Dropbox/a",
            "Library/Mobile Documents/com~apple~CloudDocs/a",
            "Google Drive/a",
            "Library/CloudStorage/OneDrive-x/a",
            "Library/CloudStorage/GoogleDrive-me/a",
        ] {
            assert!(cloud_sync_warning_in(&home.join(p), home).is_some(), "{p}");
        }
        assert!(
            cloud_sync_warning_in(
                &home.join("Library/Application Support/mail-archive/library"),
                home
            )
            .is_none()
        );
        assert!(cloud_sync_warning_in(Path::new("/Volumes/x/Dropbox/a"), home).is_none());
        assert!(cloud_sync_warning_in(&home.join("DropboxNot/a"), home).is_none());
        assert!(
            cloud_sync_warning_in(&home.join("Library/CloudStorage/Dropbox-x/a"), home)
                .unwrap()
                .contains("Dropbox")
        );
    }

    #[test]
    fn symlink_into_cloud_storage_warned() {
        let t = tempfile::tempdir().unwrap();
        let home = t.path();
        let target = home.join("Library/CloudStorage/Dropbox-x");
        std::fs::create_dir_all(&target).unwrap();
        std::os::unix::fs::symlink(&target, home.join("alias")).unwrap();
        for p in ["alias", "alias/new/lib"] {
            let w = cloud_sync_warning_in(&home.join(p), home);
            assert!(w.unwrap().contains("Dropbox"), "{p}");
        }
        std::fs::create_dir_all(home.join("plain")).unwrap();
        assert!(cloud_sync_warning_in(&home.join("plain/lib"), home).is_none());
    }

    #[test]
    fn lowercase_names_warned() {
        let t = tempfile::tempdir().unwrap();
        let home = t.path();
        assert!(cloud_sync_warning_in(&home.join("dropbox/a"), home).is_some());
        assert!(
            cloud_sync_warning_in(&home.join("library/cloudstorage/dropbox-x/a"), home).is_some()
        );
        assert!(cloud_sync_warning_in(&home.join("google drive/a"), home).is_some());
    }

    #[test]
    fn default_dir_under_home() {
        assert!(
            default_library_dir().ends_with("Library/Application Support/mail-archive/library")
        );
    }

    #[test]
    fn private_dir_and_file_modes() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join("a/b");
        create_private_dir(&d).unwrap();
        assert_eq!(
            std::fs::metadata(&d).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let f = d.join("f");
        create_private_file(&f).unwrap();
        assert_eq!(
            std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
