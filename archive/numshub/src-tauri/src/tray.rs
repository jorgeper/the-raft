//! Menu-bar tray (SPEC FR-4): three icon states and the app menu. The menu is
//! rebuilt on every state/history change (menus are cheap; live mutation isn't).

use crate::state::AppState;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Idle,
    Recording,
    Processing,
}

fn icon_path(app: &AppHandle, state: TrayState) -> anyhow::Result<std::path::PathBuf> {
    let name = match state {
        TrayState::Idle => "tray-idle.png",
        TrayState::Recording => "tray-recording.png",
        TrayState::Processing => "tray-processing.png",
    };
    Ok(app
        .path()
        .resolve(format!("resources/{name}"), tauri::path::BaseDirectory::Resource)?)
}

/// Human label for the hotkey shown in the menu ("Right ⌘", "⌃ Space", ...).
pub fn hotkey_label(binding: &str) -> String {
    binding
        .split('+')
        .map(|part| {
            let (side, base) = match part {
                p if p.ends_with("_right") => ("Right ", p.trim_end_matches("_right")),
                p if p.ends_with("_left") => ("Left ", p.trim_end_matches("_left")),
                p => ("", p),
            };
            let symbol = match base {
                "command" | "super" | "meta" => "⌘",
                "option" | "alt" => "⌥",
                "ctrl" | "control" => "⌃",
                "shift" => "⇧",
                "escape" | "esc" => "Esc",
                "space" => "Space",
                other => return format!("{side}{}", capitalize(other)),
            };
            format!("{side}{symbol}")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn build_menu(app: &AppHandle, state: TrayState) -> anyhow::Result<Menu<tauri::Wry>> {
    let app_state = app.state::<AppState>();
    let (hotkey, history_texts, last_text) = {
        let settings = app_state.settings.read().unwrap();
        let history = app_state.history.lock().unwrap();
        (
            settings.hotkey.clone(),
            history
                .list()
                .take(5)
                .map(|e| e.text.clone())
                .collect::<Vec<_>>(),
            app_state.last_transcription.lock().unwrap().clone(),
        )
    };

    let dictate_label = match state {
        TrayState::Idle => format!("Start Dictation ({})", hotkey_label(&hotkey)),
        TrayState::Recording => format!("Stop Dictation ({})", hotkey_label(&hotkey)),
        TrayState::Processing => "Transcribing…".to_string(),
    };
    let dictate = MenuItemBuilder::with_id("dictate", dictate_label)
        .enabled(state != TrayState::Processing)
        .build(app)?;

    let copy_last = MenuItemBuilder::with_id("copy_last", "Copy Last Transcription")
        .enabled(last_text.is_some())
        .build(app)?;
    let retry_last = MenuItemBuilder::with_id("retry_last", "Retry Last Transcription")
        .enabled(state == TrayState::Idle)
        .build(app)?;

    let mut history_menu = SubmenuBuilder::with_id(app, "history", "History");
    if history_texts.is_empty() {
        history_menu = history_menu
            .item(&MenuItemBuilder::with_id("hist_empty", "No transcriptions yet")
                .enabled(false)
                .build(app)?);
    } else {
        for (i, text) in history_texts.iter().enumerate() {
            let label: String = if text.chars().count() > 40 {
                format!("{}…", text.chars().take(40).collect::<String>())
            } else {
                text.clone()
            };
            history_menu = history_menu
                .item(&MenuItemBuilder::with_id(format!("hist:{i}"), label).build(app)?);
        }
    }
    let history_menu = history_menu.build()?;

    let settings_item =
        MenuItemBuilder::with_id("settings", "Settings…").accelerator("CmdOrCtrl+,").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Numshub")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    Ok(MenuBuilder::new(app)
        .item(&dictate)
        .separator()
        .item(&copy_last)
        .item(&retry_last)
        .item(&history_menu)
        .separator()
        .item(&settings_item)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?)
}

pub fn create(app: &AppHandle) -> anyhow::Result<()> {
    let icon = tauri::image::Image::from_path(icon_path(app, TrayState::Idle)?)?;
    let tray = TrayIconBuilder::with_id("numshub-tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Numshub")
        .show_menu_on_left_click(true)
        .menu(&build_menu(app, TrayState::Idle)?)
        .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
        .build(app)?;
    app.manage(tray);
    Ok(())
}

pub fn set_state(app: &AppHandle, state: TrayState) {
    if let Some(tray) = app.try_state::<TrayIcon>() {
        if let Ok(path) = icon_path(app, state) {
            if let Ok(icon) = tauri::image::Image::from_path(path) {
                let _ = tray.set_icon(Some(icon));
                let _ = tray.set_icon_as_template(true);
            }
        }
        if let Ok(menu) = build_menu(app, state) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Rebuild the menu without changing the icon (history/settings changed).
pub fn refresh_menu(app: &AppHandle, state: TrayState) {
    if let Some(tray) = app.try_state::<TrayIcon>() {
        if let Ok(menu) = build_menu(app, state) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn on_menu_event(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    match id {
        "dictate" => state.pipeline.toggle(),
        "copy_last" => {
            let text = state.last_transcription.lock().unwrap().clone();
            if let Some(text) = text {
                let _ = crate::paste::copy_to_clipboard(&text);
            }
        }
        "retry_last" => state.pipeline.retry(),
        "settings" => crate::show_settings_window(app, None),
        "quit" => app.exit(0),
        id if id.starts_with("hist:") => {
            if let Ok(index) = id.trim_start_matches("hist:").parse::<usize>() {
                let text = state
                    .history
                    .lock()
                    .unwrap()
                    .list()
                    .nth(index)
                    .map(|e| e.text.clone());
                if let Some(text) = text {
                    let _ = crate::paste::copy_to_clipboard(&text);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkey_labels_render_human_readable() {
        assert_eq!(hotkey_label("command_right"), "Right ⌘");
        assert_eq!(hotkey_label("ctrl+space"), "⌃ Space");
        assert_eq!(hotkey_label("option_left+shift+a"), "Left ⌥ ⇧ A");
    }
}
