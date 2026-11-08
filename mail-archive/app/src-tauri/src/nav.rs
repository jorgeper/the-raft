//! Where a navigation or new-window request from the web view may go.
//!
//! The decision is a pure function so it can be tested; `main.rs` wires it to
//! the web view's `on_navigation` and `on_new_window` hooks. Mail bodies live
//! in a sandboxed iframe whose links carry `target="_blank"`, so the usual
//! case is a new-window request for an https URL: deny the window and hand the
//! URL to the same validator and opener `open_link` uses.

use tauri::Url;

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
    let mut s = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
    if let Some(p) = url.port() {
        s.push_str(&format!(":{p}"));
    }
    s
}

/// `app_origins` are the origin keys the app itself is served from:
/// `tauri://localhost` in a bundle, plus the dev server URL in dev.
///
/// Decisions:
/// - the app's own origins and `ipc://localhost` (Tauri's IPC bridge): allow;
/// - `mailbody://localhost`: allow (the iframe's document);
/// - `mailcid://` is only ever a subresource of a body (images). A navigation
///   to it would show an attachment as a top-level document, so deny;
/// - `about:blank`: allow (an empty frame, no content, no network);
/// - http, https, mailto: open externally if `validate_link` accepts;
/// - everything else (javascript:, file:, data:, blob:, ftp:, ...): deny.
pub fn route_navigation(url: &Url, app_origins: &[String]) -> NavDecision {
    match url.scheme() {
        "mailbody" if url.host_str() == Some("localhost") => NavDecision::Allow,
        "ipc" if url.host_str() == Some("localhost") => NavDecision::Allow,
        "about" if url.as_str() == "about:blank" => NavDecision::Allow,
        "http" | "https" | "mailto" => {
            if app_origins.contains(&origin_key(url)) {
                NavDecision::Allow
            } else if crate::commands::validate_link(url.as_str()).is_ok() {
                NavDecision::OpenExternal(url.as_str().to_string())
            } else {
                NavDecision::Deny
            }
        }
        "tauri" if app_origins.contains(&origin_key(url)) => NavDecision::Allow,
        _ => NavDecision::Deny,
    }
}

/// Opens off the calling thread: the hooks run on the main thread and `open`
/// must not block it.
pub fn open_external(url: String) {
    std::thread::spawn(move || {
        let _ = crate::commands::run_open(&url);
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
    fn ipc_origin_is_allowed() {
        assert_eq!(route("ipc://localhost/search"), NavDecision::Allow);
        assert_eq!(route("ipc://evil/search"), NavDecision::Deny);
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
