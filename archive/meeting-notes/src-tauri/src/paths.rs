//! App-data locations. `MINUTES_DATA_DIR` overrides the root (tests).

use std::path::PathBuf;

pub fn data_root() -> PathBuf {
    if let Ok(dir) = std::env::var("MINUTES_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir().expect("no platform data dir").join("com.jorgeper.minutes")
}

pub fn recovery_json() -> PathBuf {
    data_root().join("recovery").join("current.json")
}

pub fn recovery_pcm() -> PathBuf {
    data_root().join("recovery").join("current.pcm")
}

pub fn clear_recovery() {
    std::fs::remove_file(recovery_json()).ok();
    std::fs::remove_file(recovery_pcm()).ok();
}
