//! Recording overlay (SPEC FR-2): a small pill near the bottom-center of the
//! active screen that NEVER takes focus. macOS: non-activating NSPanel via
//! tauri-nspanel; Windows/other: non-focusable always-on-top window. This file
//! is the platform-abstraction boundary for the overlay (see ARCHITECTURE.md).
//! Patterns adapted from Handy (MIT).

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl};

pub const OVERLAY_LABEL: &str = "overlay";
pub const OVERLAY_WIDTH: f64 = 320.0;
pub const OVERLAY_HEIGHT: f64 = 64.0;
const BOTTOM_OFFSET: f64 = 24.0;

/// Overlay states rendered by the frontend pill (SPEC FR-1.6, FR-2, FR-3.4).
pub mod state {
    pub const RECORDING: &str = "recording";
    pub const TRANSCRIBING: &str = "transcribing";
    pub const NOTHING_HEARD: &str = "nothing-heard";
    pub const NO_MODEL: &str = "no-model";
}

static OVERLAY_VISIBLE: AtomicBool = AtomicBool::new(false);
static SHOW_GENERATION: AtomicU64 = AtomicU64::new(0);
static LAST_LEVEL_EMIT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct ShowPayload {
    state: String,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

    tauri_panel! {
        panel!(OverlayPanel {
            config: {
                can_become_key_window: false,
                is_floating_panel: true
            }
        })
    }

    pub fn create(app: &AppHandle) -> anyhow::Result<()> {
        PanelBuilder::<_, OverlayPanel>::new(app, OVERLAY_LABEL)
            .url(WebviewUrl::App("index.html?window=overlay".into()))
            .title("Numshub")
            .level(PanelLevel::Status)
            .size(tauri::Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }))
            .has_shadow(false)
            .transparent(true)
            .no_activate(true)
            .corner_radius(0.0)
            .style_mask(StyleMask::empty().borderless().nonactivating_panel())
            .with_window(|w| w.decorations(false).transparent(true).focusable(false))
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary(),
            )
            .build()
            .map_err(|e| anyhow::anyhow!("creating overlay panel: {e}"))?;
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = window.hide();
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    use tauri::WebviewWindowBuilder;

    pub fn create(app: &AppHandle) -> anyhow::Result<()> {
        WebviewWindowBuilder::new(
            app,
            OVERLAY_LABEL,
            WebviewUrl::App("index.html?window=overlay".into()),
        )
        .title("Numshub")
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .accept_first_mouse(true)
        .closable(false)
        .maximizable(false)
        .minimizable(false)
        .build()?;
        Ok(())
    }
}

pub fn create(app: &AppHandle) -> anyhow::Result<()> {
    platform::create(app)
}

/// Position the pill bottom-center of the monitor containing the cursor
/// (logical coordinates — physical positions convert with the wrong monitor's
/// scale factor when moving across screens).
fn position(app: &AppHandle) -> Option<tauri::LogicalPosition<f64>> {
    let window = app.get_webview_window(OVERLAY_LABEL)?;
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    let mpos = monitor.position().to_logical::<f64>(scale);
    let msize = monitor.size().to_logical::<f64>(scale);
    let x = mpos.x + (msize.width - OVERLAY_WIDTH) / 2.0;
    let y = mpos.y + msize.height - OVERLAY_HEIGHT - BOTTOM_OFFSET;
    let _ = window;
    Some(tauri::LogicalPosition { x, y })
}

pub fn show_state(app: &AppHandle, state: &str) {
    let generation = SHOW_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        if let Some(pos) = position(app) {
            let _ = window.set_position(tauri::Position::Logical(pos));
        }
        let _ = window.show();
        OVERLAY_VISIBLE.store(true, Ordering::SeqCst);
        let _ = app.emit_to(
            OVERLAY_LABEL,
            "show-overlay",
            ShowPayload {
                state: state.to_string(),
            },
        );
    }
    // Transient states auto-dismiss (SPEC: nothing-heard ~1 s, no-model ~6 s).
    let auto_hide_ms = match state {
        state::NOTHING_HEARD => Some(1200),
        state::NO_MODEL => Some(6000),
        _ => None,
    };
    if let Some(ms) = auto_hide_ms {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            if SHOW_GENERATION.load(Ordering::SeqCst) == generation {
                hide(&app);
            }
        });
    }
}

pub fn hide(app: &AppHandle) {
    OVERLAY_VISIBLE.store(false, Ordering::SeqCst);
    let _ = app.emit_to(OVERLAY_LABEL, "hide-overlay", ());
    let app = app.clone();
    // Let the CSS fade-out play before the window vanishes.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(220));
        if !OVERLAY_VISIBLE.load(Ordering::SeqCst) {
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                let _ = window.hide();
            }
        }
    });
}

/// Forward a mic level (0..1) to the overlay at most ~30×/s. Even a hidden
/// webview pays for every event, so skip entirely when not visible.
pub fn emit_level(app: &AppHandle, level: f32) {
    if !OVERLAY_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_LEVEL_EMIT.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 30 {
        return;
    }
    LAST_LEVEL_EMIT.store(now, Ordering::Relaxed);
    let _ = app.emit_to(OVERLAY_LABEL, "mic-level", level);
}
