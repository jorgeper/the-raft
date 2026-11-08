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

pub(crate) fn cloud_sync_warning_in(p: &Path, home: &Path) -> Option<&'static str> {
    let rel = p.strip_prefix(home).ok()?;
    let mut c = rel.components().map(|c| c.as_os_str().to_string_lossy());
    let first = c.next()?;
    let second = c.next();
    match (first.as_ref(), second.as_deref()) {
        ("Library", Some("CloudStorage")) => {
            let provider = c.next().unwrap_or_default();
            Some(if provider.starts_with("Dropbox") {
                DROPBOX
            } else if provider.starts_with("OneDrive") {
                ONEDRIVE
            } else if provider.starts_with("GoogleDrive") {
                GOOGLE
            } else {
                GENERIC
            })
        }
        ("Library", Some("Mobile Documents")) => Some(ICLOUD),
        ("Dropbox", _) => Some(DROPBOX),
        ("Google Drive", _) => Some(GOOGLE),
        ("OneDrive", _) => Some(ONEDRIVE),
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
