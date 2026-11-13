//! User overlay themes (SPEC6 FR-A4): drop-in .css files in
//! `<app data dir>/themes/`, marky-mark style. Size-capped, count-capped,
//! and remote url() references are rejected — SPEC §1's no-network guarantee
//! extends to themes.

use serde::Serialize;
use std::path::Path;

pub const MAX_THEME_BYTES: u64 = 64 * 1024;
pub const MAX_THEMES: usize = 100;

#[derive(Debug, Clone, Serialize)]
pub struct UserTheme {
    /// Picker id, prefixed to never collide with built-ins: `user:<file-stem>`.
    pub id: String,
    pub name: String,
    pub variant: String,
    /// Empty when rejected.
    pub css: String,
    /// Why the theme is disabled in the picker; None = usable.
    pub reason: Option<String>,
}

fn meta_tag(comment: &str, tag: &str) -> Option<String> {
    let needle = format!("@{tag}:");
    comment.lines().find_map(|line| {
        line.find(&needle)
            .map(|i| line[i + needle.len()..].trim_end_matches("*/").trim().to_string())
    })
}

/// Anything that could make the webview fetch a remote resource. Themes are
/// simple variable files, so this is deliberately blunt:
/// - `url(...)` pointing at http(s) or protocol-relative hosts;
/// - `@import` in any form (its string syntax bypasses url() checks, and
///   local imports are meaningless for an injected style tag);
/// - backslashes anywhere (CSS escape sequences like `url(\68ttp://…)` can
///   smuggle a scheme past pattern checks).
fn remote_capable(css: &str) -> Option<&'static str> {
    if css.contains('\\') {
        return Some("contains CSS escape sequences — not allowed in themes");
    }
    let compact = css.to_lowercase().replace(char::is_whitespace, "");
    if compact.contains("@import") {
        return Some("uses @import — not allowed in themes");
    }
    let remote = ["url(http", "url('http", "url(\"http", "url(//", "url('//", "url(\"//"]
        .iter()
        .any(|pat| compact.contains(pat));
    if remote {
        return Some("references a remote url() — Numshub themes are offline-only");
    }
    None
}

/// Read the themes directory. Missing dir = empty list, never an error.
pub fn list_user_themes(dir: &Path) -> Vec<UserTheme> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut themes: Vec<UserTheme> = Vec::new();
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "css").unwrap_or(false))
        .collect();
    files.sort();
    for path in files.into_iter().take(MAX_THEMES) {
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let id = format!("user:{stem}");
        let fallback_name = stem.replace(['-', '_'], " ");

        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size > MAX_THEME_BYTES {
            themes.push(UserTheme {
                id,
                name: fallback_name,
                variant: "dark".into(),
                css: String::new(),
                reason: Some(format!("file is larger than {} KB", MAX_THEME_BYTES / 1024)),
            });
            continue;
        }
        let Ok(css) = std::fs::read_to_string(&path) else {
            continue;
        };

        // Leading metadata comment (marky-mark format).
        let comment = css
            .trim_start()
            .strip_prefix("/*")
            .and_then(|rest| rest.split("*/").next())
            .unwrap_or("");
        let name = meta_tag(comment, "name").unwrap_or(fallback_name);
        let variant = meta_tag(comment, "variant").unwrap_or_else(|| "dark".into());

        if let Some(reason) = remote_capable(&css) {
            themes.push(UserTheme {
                id,
                name,
                variant,
                css: String::new(),
                reason: Some(reason.into()),
            });
            continue;
        }
        themes.push(UserTheme {
            id,
            name,
            variant,
            css,
            reason: None,
        });
    }
    themes
}

/// First run: create the folder and drop this guide next to it.
pub fn ensure_themes_dir(data_dir: &Path) {
    let dir = data_dir.join("themes");
    if std::fs::create_dir_all(&dir).is_ok() {
        let guide = dir.join("THEMES.md");
        if !guide.exists() {
            let _ = std::fs::write(&guide, include_str!("../../THEMES.md"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // R11: user theme loading — parse, caps, remote-url rejection, missing dir.
    #[test]
    fn r11_valid_theme_parses_metadata() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("ocean.css"),
            "/* @name: Midnight Ocean\n @author: jorge\n @variant: dark */\n.nh-theme { --nh-text: #fff; }",
        )
        .unwrap();
        let themes = list_user_themes(dir.path());
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].id, "user:ocean");
        assert_eq!(themes[0].name, "Midnight Ocean");
        assert_eq!(themes[0].variant, "dark");
        assert!(themes[0].reason.is_none());
        assert!(themes[0].css.contains("--nh-text"));
    }

    #[test]
    fn r11_filename_fallback_when_no_metadata() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("my-cool_theme.css"), ".nh-theme { }").unwrap();
        let themes = list_user_themes(dir.path());
        assert_eq!(themes[0].name, "my cool theme");
    }

    #[test]
    fn r11_remote_url_rejected_with_reason() {
        let dir = tempfile::tempdir().unwrap();
        for (file, css) in [
            ("a.css", ".nh-theme { background: url(https://evil.example/x.png); }"),
            ("b.css", ".nh-theme { background: url( 'http://x.example/y' ); }"),
            ("c.css", ".nh-theme { src: url(//cdn.example/font.woff); }"),
            // @import string syntax has no url() — must still be rejected.
            ("d.css", "@import \"https://evil.example/steal.css\";\n.nh-theme { }"),
            ("e.css", "@import url(evil.css);\n.nh-theme { }"),
            // CSS escapes can smuggle a scheme past pattern checks.
            ("f.css", ".nh-theme { background: url(\\68ttps://evil.example/x); }"),
        ] {
            std::fs::write(dir.path().join(file), css).unwrap();
        }
        let themes = list_user_themes(dir.path());
        assert_eq!(themes.len(), 6);
        for theme in &themes {
            assert!(theme.reason.is_some(), "{} should be rejected", theme.id);
            assert!(theme.css.is_empty());
        }
        // Local url() stays allowed (e.g. data: URIs).
        let dir2 = tempfile::tempdir().unwrap();
        std::fs::write(
            dir2.path().join("ok.css"),
            ".nh-theme { background: url(data:image/png;base64,AAAA); }",
        )
        .unwrap();
        assert!(list_user_themes(dir2.path())[0].reason.is_none());
    }

    #[test]
    fn r11_oversize_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let big = ".nh-theme { /* pad */ }".to_string() + &"x".repeat(70 * 1024);
        std::fs::write(dir.path().join("big.css"), big).unwrap();
        let themes = list_user_themes(dir.path());
        assert!(themes[0].reason.as_deref().unwrap_or("").contains("64 KB"));
    }

    #[test]
    fn r11_missing_dir_is_empty_not_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_user_themes(&dir.path().join("nope")).is_empty());
    }

    #[test]
    fn r11_settings_fields_default_from_legacy_json() {
        let legacy = r#"{"hotkey":"command_right"}"#;
        let settings: crate::settings::Settings = serde_json::from_str(legacy).unwrap();
        assert_eq!(settings.overlay_effect, "classic-bars");
        assert_eq!(settings.overlay_theme, "indigo");
    }
}
