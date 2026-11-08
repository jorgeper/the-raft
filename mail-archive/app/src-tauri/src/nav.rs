//! Where a navigation or new-window request from the web view may go.
//!
//! The decision is a pure function so it can be tested; `main.rs` wires it to
//! the web view's `on_navigation` and `on_new_window` hooks. Mail bodies live
//! in a sandboxed iframe whose links carry `target="_blank"`, so the usual
//! case is a new-window request for an https URL: deny the window and hand the
//! URL to the same validator and opener `open_link` uses.

use tauri::{AppHandle, Emitter, Url};

#[derive(Debug, PartialEq, Eq)]
pub enum NavDecision {
    /// Let the web view load it.
    Allow,
    /// Cancel it, do nothing else.
    Deny,
    /// Cancel it and open this URL in the default handler (validated).
    OpenExternal(String),
}

/// `scheme://host[:port]` as a comparison key. `Url::origin` is opaque for
/// custom schemes such as `tauri:`, so build it by hand.
pub fn origin_key(url: &Url) -> String {
    let mut s = format!(
        "{}://{}",
        url.scheme(),
        url.host_str().unwrap_or("").to_ascii_lowercase()
    );
    if let Some(p) = url.port() {
        s.push_str(&format!(":{p}"));
    }
    s
}

/// Hosts of non-special schemes (`tauri:`, `mailbody:`) keep their case in `Url`.
fn is_localhost(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|h| h.eq_ignore_ascii_case("localhost"))
}

/// `app_origins` are the origin keys the app itself is served from:
/// `tauri://localhost` in a bundle, plus the dev server URL in dev.
///
/// Decisions:
/// - the app's own origins: allow (a URL with userinfo is never "the app");
/// - `mailbody://localhost`: allow (the iframe's document);
/// - `ipc://localhost` is Tauri's fetch bridge, which is a request and never a
///   navigation, so a navigation to it is denied;
/// - `mailcid://` is only ever a subresource of a body (images). A navigation
///   to it would show an attachment as a top-level document, so deny;
/// - `about:blank`: allow (an empty frame, no content, no network);
/// - http, https, mailto: open externally if `validate_link` accepts;
/// - everything else (javascript:, file:, data:, blob:, ftp:, ...): deny.
///
/// Layers: tauri-runtime-wry hands the hook a parsed `Url`; if the native URL
/// string fails to parse it lets the navigation proceed without calling the
/// hook. This function is therefore not the only barrier. The page CSP
/// (`default-src 'self'`, `frame-src mailbody:`), the iframe sandbox (no
/// scripts, no same-origin, no top navigation) and the body CSP and sanitizer
/// (no remote resources, links are plain `target=_blank`) cover that case.
pub fn route_navigation(url: &Url, app_origins: &[String]) -> NavDecision {
    let userinfo = !url.username().is_empty() || url.password().is_some();
    match url.scheme() {
        "mailbody" if is_localhost(url) && !userinfo => NavDecision::Allow,
        "about" if url.as_str() == "about:blank" => NavDecision::Allow,
        "http" | "https" | "mailto" => {
            if !userinfo && app_origins.contains(&origin_key(url)) {
                NavDecision::Allow
            } else if crate::commands::validate_link(url.as_str()).is_ok() {
                NavDecision::OpenExternal(url.as_str().to_string())
            } else {
                NavDecision::Deny
            }
        }
        "tauri" if !userinfo && app_origins.contains(&origin_key(url)) => NavDecision::Allow,
        _ => NavDecision::Deny,
    }
}

/// Opens off the calling thread: the hooks run on the main thread and `open`
/// must not block it. A failure is logged with fixed text (no URL) and the UI
/// is told through the `open-failed` event so it can show a transient note.
pub fn open_external(app: AppHandle, url: String) {
    std::thread::spawn(move || {
        if crate::commands::run_open(&url).is_err() {
            eprintln!("mail-archive: could not open a link");
            let _ = app.emit("open-failed", ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        s.parse().unwrap()
    }
    fn origins() -> Vec<String> {
        vec!["tauri://localhost".into(), "http://127.0.0.1:1420".into()]
    }
    fn route(s: &str) -> NavDecision {
        route_navigation(&u(s), &origins())
    }

    #[test]
    fn app_origins_are_allowed() {
        assert_eq!(route("tauri://localhost/index.html"), NavDecision::Allow);
        assert_eq!(route("http://127.0.0.1:1420/"), NavDecision::Allow);
    }

    #[test]
    fn other_tauri_hosts_and_dev_ports_are_not_the_app() {
        assert_eq!(route("tauri://evil/"), NavDecision::Deny);
        assert_eq!(
            route("http://127.0.0.1:9999/"),
            NavDecision::OpenExternal("http://127.0.0.1:9999/".into())
        );
    }

    #[test]
    fn dev_origin_is_not_allowed_when_not_configured() {
        let only_prod = vec!["tauri://localhost".to_string()];
        assert_ne!(
            route_navigation(&u("http://127.0.0.1:1420/"), &only_prod),
            NavDecision::Allow
        );
    }

    #[test]
    fn mailbody_is_allowed_and_mailcid_is_not_a_navigation() {
        assert_eq!(route("mailbody://localhost/12?t=a"), NavDecision::Allow);
        assert_eq!(route("mailbody://evil/12"), NavDecision::Deny);
        assert_eq!(route("mailcid://localhost/12/abc"), NavDecision::Deny);
    }

    #[test]
    fn ipc_is_a_request_not_a_navigation() {
        assert_eq!(route("ipc://localhost/search"), NavDecision::Deny);
        assert_eq!(route("ipc://evil/search"), NavDecision::Deny);
    }

    #[test]
    fn look_alike_origins_are_not_the_app() {
        assert_eq!(route("tauri://localhost.evil/"), NavDecision::Deny);
        assert_eq!(route("tauri://localhost:1234/"), NavDecision::Deny);
        assert_eq!(route("tauri://u@localhost/"), NavDecision::Deny);
        assert_eq!(route("mailbody://u@localhost/1"), NavDecision::Deny);
        // userinfo on the dev origin: not the app, so it goes to the browser
        assert_eq!(
            route("http://u@127.0.0.1:1420/"),
            NavDecision::OpenExternal("http://u@127.0.0.1:1420/".into())
        );
        assert_eq!(
            route("https://127.0.0.1:1420/"),
            NavDecision::OpenExternal("https://127.0.0.1:1420/".into())
        );
    }

    #[test]
    fn scheme_and_host_case_variants_normalise() {
        assert_eq!(route("TAURI://LOCALHOST/index.html"), NavDecision::Allow);
        assert_eq!(route("MAILBODY://LocalHost/1"), NavDecision::Allow);
        assert_eq!(route("HTTP://127.0.0.1:1420/"), NavDecision::Allow);
        assert_eq!(
            route("HTTPS://Example.ORG/Path"),
            NavDecision::OpenExternal("https://example.org/Path".into())
        );
        assert_eq!(route("JavaScript:alert(1)"), NavDecision::Deny);
        assert_eq!(route("FILE:///etc/passwd"), NavDecision::Deny);
    }

    #[test]
    fn web_and_mail_links_open_externally() {
        assert_eq!(
            route("https://example.org/a?b=1"),
            NavDecision::OpenExternal("https://example.org/a?b=1".into())
        );
        assert_eq!(
            route("http://example.org/"),
            NavDecision::OpenExternal("http://example.org/".into())
        );
        assert_eq!(
            route("mailto:ana@example.org"),
            NavDecision::OpenExternal("mailto:ana@example.org".into())
        );
    }

    #[test]
    fn dangerous_schemes_are_denied() {
        for s in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<b>x</b>",
            "blob:https://example.org/uuid",
            "ftp://example.org/",
            "about:srcdoc",
            "view-source:https://example.org/",
        ] {
            assert_eq!(route(s), NavDecision::Deny, "{s}");
        }
    }

    #[test]
    fn about_blank_is_allowed() {
        assert_eq!(route("about:blank"), NavDecision::Allow);
    }
}
