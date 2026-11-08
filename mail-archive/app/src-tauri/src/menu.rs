//! The native menu bar.
//!
//! Frontend events (emitted app-wide, no payload):
//! - `menu-import-takeout`: File > Import Takeout... (Cmd+I); the UI opens the import dialog.
//! - `menu-rebuild-index`: File > Rebuild Index; the UI asks for confirmation, then rebuilds.
//!
//! "Show Library in Finder" is handled here in Rust (it needs no UI).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::{AppState, run_reveal};

pub const EVENT_IMPORT: &str = "menu-import-takeout";
pub const EVENT_REBUILD: &str = "menu-rebuild-index";

const ID_IMPORT: &str = "import-takeout";
const ID_REBUILD: &str = "rebuild-index";
const ID_REVEAL: &str = "show-library";

#[derive(Debug, PartialEq, Eq)]
pub enum MenuAction {
    Emit(&'static str),
    RevealLibrary,
}

pub fn action_for(id: &str) -> Option<MenuAction> {
    match id {
        ID_IMPORT => Some(MenuAction::Emit(EVENT_IMPORT)),
        ID_REBUILD => Some(MenuAction::Emit(EVENT_REBUILD)),
        ID_REVEAL => Some(MenuAction::RevealLibrary),
        _ => None,
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = app.package_info().name.clone();
    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                ID_IMPORT,
                "Import Takeout\u{2026}",
                true,
                Some("CmdOrCtrl+I"),
            )?,
            &MenuItem::with_id(app, ID_REBUILD, "Rebuild Index", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, ID_REVEAL, "Show Library in Finder", true, None::<&str>)?,
        ],
    )?;
    // The standard Edit items keep Cmd+C/V/X/A/Z working in the search box.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &window])
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match action_for(id) {
        Some(MenuAction::Emit(event)) => {
            let _ = app.emit(event, ());
        }
        Some(MenuAction::RevealLibrary) => {
            let st = app.state::<AppState>().inner().clone();
            std::thread::spawn(move || {
                if st.reveal_library_with(&run_reveal).is_err() {
                    eprintln!("mail-archive: could not reveal the library");
                }
            });
        }
        None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_items_map_to_actions() {
        assert_eq!(
            action_for("import-takeout"),
            Some(MenuAction::Emit("menu-import-takeout"))
        );
        assert_eq!(
            action_for("rebuild-index"),
            Some(MenuAction::Emit("menu-rebuild-index"))
        );
        assert_eq!(action_for("show-library"), Some(MenuAction::RevealLibrary));
        // Predefined items (copy, quit, ...) are handled natively.
        assert_eq!(action_for("copy"), None);
    }
}
