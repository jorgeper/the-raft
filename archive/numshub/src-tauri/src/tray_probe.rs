//! Ground-truth check for "is our menu-bar icon actually visible?"
//! (SPEC2 FR-O2c). macOS 26 gates third-party status items behind a per-app
//! "Allow in the Menu Bar" setting; a suppressed item still exists but is
//! collapsed to zero width. CGWindowList sees that truth: a visible status
//! item is a layer-25 window owned by this process with width > 0.

#[cfg(target_os = "macos")]
pub fn tray_item_visible() -> bool {
    use core_foundation::array::CFArray;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListOptionAll, CGWindowListCopyWindowInfo,
    };

    const STATUS_WINDOW_LAYER: i64 = 25; // NSStatusWindowLevel
    let pid = std::process::id() as i64;

    let info = unsafe { CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID) };
    if info.is_null() {
        return false;
    }
    let windows: CFArray<CFDictionary> = unsafe { CFArray::wrap_under_create_rule(info as _) };

    let key = |name: &str| CFString::new(name);
    for window in windows.iter() {
        let get_i64 = |k: &str| -> Option<i64> {
            window
                .find(key(k).as_CFTypeRef() as *const _)
                .and_then(|v| {
                    let n = unsafe { CFNumber::wrap_under_get_rule(*v as _) };
                    n.to_i64()
                })
        };
        if get_i64("kCGWindowOwnerPID") != Some(pid) {
            continue;
        }
        if get_i64("kCGWindowLayer") != Some(STATUS_WINDOW_LAYER) {
            continue;
        }
        // Bounds dictionary: {X, Y, Width, Height}. Status items sit at the
        // top of the screen; the overlay panel is also layer 25 but far from
        // Y=0 and much taller than a menu bar item.
        if let Some(bounds_ref) = window.find(key("kCGWindowBounds").as_CFTypeRef() as *const _) {
            let bounds: CFDictionary =
                unsafe { CFDictionary::wrap_under_get_rule(*bounds_ref as _) };
            let get_f64 = |k: &str| -> f64 {
                bounds
                    .find(key(k).as_CFTypeRef() as *const _)
                    .and_then(|v| {
                        let n = unsafe { CFNumber::wrap_under_get_rule(*v as _) };
                        n.to_f64()
                    })
                    .unwrap_or(0.0)
            };
            let (y, width, height) = (get_f64("Y"), get_f64("Width"), get_f64("Height"));
            if y < 2.0 && height > 0.0 && height <= 60.0 && width > 0.0 {
                return true;
            }
        }
    }
    false
}

#[cfg(not(target_os = "macos"))]
pub fn tray_item_visible() -> bool {
    // Windows/Linux have no per-app menu-bar gating; the tray either works
    // or errors loudly at creation.
    true
}

/// Open the System Settings pane where the user can allow the menu-bar item.
#[cfg(target_os = "macos")]
pub fn open_menu_bar_settings() {
    // The Menu Bar allowance lives under Control Center settings on macOS 26.
    // Fall back to the System Settings root if the deep link is rejected.
    let attempted = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.ControlCenter-Settings.extension")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !attempted {
        let _ = std::process::Command::new("open")
            .arg("/System/Applications/System Settings.app")
            .status();
    }
}

#[cfg(not(target_os = "macos"))]
pub fn open_menu_bar_settings() {}
