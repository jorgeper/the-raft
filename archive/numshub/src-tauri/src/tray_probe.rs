//! Ground-truth check for "is our menu-bar icon actually visible?"
//! (SPEC2 FR-O2c). macOS 26 gates third-party status items behind a per-app
//! "Allow in the Menu Bar" setting; a suppressed item still exists but is
//! collapsed to zero width.
//!
//! Implementation note: CGWindowList is NOT reliable for this on macOS 26 —
//! Control Center hosts visible third-party items, so the app's own window
//! list shows a zero-size placeholder when suppressed and nothing at all when
//! visible. The in-process AppKit view is authoritative: the status item owns
//! an NSStatusBarWindow whose frame collapses to zero width when the OS
//! suppresses it and whose occlusion state reports actual display.
//! MUST be called on the main thread (AppKit).

#[cfg(target_os = "macos")]
pub fn tray_item_visible_main_thread() -> bool {
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};
    use objc2_foundation::NSRect;
    use std::ffi::CStr;

    const OCCLUSION_VISIBLE: usize = 1 << 1; // NSWindowOcclusionStateVisible

    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return false;
        }
        let windows: *mut AnyObject = msg_send![app, windows];
        if windows.is_null() {
            return false;
        }
        let count: usize = msg_send![windows, count];
        for i in 0..count {
            let window: *mut AnyObject = msg_send![windows, objectAtIndex: i];
            if window.is_null() {
                continue;
            }
            let class_obj: *mut AnyObject = msg_send![window, class];
            let class_name: *mut AnyObject = msg_send![class_obj, description];
            let cstr: *const std::os::raw::c_char = msg_send![class_name, UTF8String];
            if cstr.is_null() {
                continue;
            }
            let name = CStr::from_ptr(cstr).to_string_lossy();
            if !name.contains("NSStatusBarWindow") {
                continue;
            }
            let frame: NSRect = msg_send![window, frame];
            let is_visible: Bool = msg_send![window, isVisible];
            let occlusion: usize = msg_send![window, occlusionState];
            log::debug!(
                "status bar window: frame {}x{}, visible={}, occlusion_visible={}",
                frame.size.width,
                frame.size.height,
                is_visible.as_bool(),
                occlusion & OCCLUSION_VISIBLE != 0
            );
            // Suppressed items collapse to (near) zero width. Do NOT require
            // the occlusion-visible bit: on macOS 26 Control Center hosts the
            // rendered item, so the app-side window never reports it —
            // measured on a really-visible icon: frame 34x33, isVisible=true,
            // occlusion_visible=false.
            return is_visible.as_bool() && frame.size.width > 4.0;
        }
    }
    // No status bar window at all: the tray was not created.
    false
}

#[cfg(not(target_os = "macos"))]
pub fn tray_item_visible_main_thread() -> bool {
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
