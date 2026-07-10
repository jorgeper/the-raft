//! Output stage (SPEC FR-3): clipboard write + synthesized paste keystroke,
//! then clipboard restore. Layout-independent key codes (adapted from Handy,
//! MIT): macOS kVK_ANSI_V (9) + Meta, Windows VK_V (0x56) + Ctrl.

use crate::settings::OutputMethod;
use anyhow::{Context, Result};
use enigo::{Direction, Enigo, Key, Keyboard};
use std::time::Duration;

/// Milliseconds to let the clipboard settle before the paste keystroke.
const PRE_PASTE_DELAY_MS: u64 = 50;
/// SPEC FR-3.1: restore the previous clipboard ~300 ms after the paste.
const RESTORE_DELAY_MS: u64 = 300;

pub struct Paster {
    enigo: Option<Enigo>,
}

impl Paster {
    /// On macOS, Enigo construction fails without Accessibility permission —
    /// callers treat `enigo: None` as "degrade to clipboard-only" (FR-3.3).
    pub fn new() -> Self {
        let enigo = Enigo::new(&enigo::Settings::default())
            .map_err(|e| log::warn!("enigo init failed (accessibility not granted?): {e}"))
            .ok();
        Self { enigo }
    }

    pub fn can_paste(&self) -> bool {
        self.enigo.is_some()
    }

    /// Retry Enigo init (after the user grants Accessibility mid-session).
    pub fn reinit(&mut self) -> bool {
        if self.enigo.is_none() {
            self.enigo = Enigo::new(&enigo::Settings::default()).ok();
        }
        self.can_paste()
    }

    /// Deliver `text` per the configured output method. Returns true if a paste
    /// keystroke was sent (false = clipboard-only, either by setting or fallback).
    /// Must run on the main thread on macOS.
    pub fn deliver(&mut self, text: &str, method: OutputMethod) -> Result<bool> {
        let mut clipboard = arboard::Clipboard::new().context("opening clipboard")?;

        if method == OutputMethod::ClipboardOnly || self.enigo.is_none() {
            clipboard.set_text(text).context("writing clipboard")?;
            return Ok(false);
        }

        // Save -> write -> paste -> restore.
        let saved = clipboard.get_text().ok();
        clipboard.set_text(text).context("writing clipboard")?;
        std::thread::sleep(Duration::from_millis(PRE_PASTE_DELAY_MS));

        let enigo = self.enigo.as_mut().unwrap();
        send_paste_keystroke(enigo)?;

        std::thread::sleep(Duration::from_millis(RESTORE_DELAY_MS));
        if let Some(saved) = saved {
            let _ = clipboard.set_text(saved);
        }
        Ok(true)
    }

}

/// Plain clipboard write (Copy Last Transcription, history clicks, retry) —
/// needs no Enigo/Accessibility.
pub fn copy_to_clipboard(text: &str) -> Result<()> {
    let mut clipboard = arboard::Clipboard::new().context("opening clipboard")?;
    clipboard.set_text(text).context("writing clipboard")?;
    Ok(())
}

fn send_paste_keystroke(enigo: &mut Enigo) -> Result<()> {
    #[cfg(target_os = "macos")]
    let (modifier, v_key) = (Key::Meta, Key::Other(9)); // kVK_ANSI_V — layout-independent
    #[cfg(target_os = "windows")]
    let (modifier, v_key) = (Key::Control, Key::Other(0x56)); // VK_V
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let (modifier, v_key) = (Key::Control, Key::Unicode('v'));

    enigo
        .key(modifier, Direction::Press)
        .context("pressing paste modifier")?;
    enigo.key(v_key, Direction::Click).context("pressing V")?;
    std::thread::sleep(Duration::from_millis(100));
    enigo
        .key(modifier, Direction::Release)
        .context("releasing paste modifier")?;
    Ok(())
}
