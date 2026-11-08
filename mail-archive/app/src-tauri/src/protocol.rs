//! `mailbody://` and `mailcid://` handlers, the body URL format, and the
//! render cache. Every handler returns 404 on anything malformed and never
//! panics.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use mail_core::render::{BODY_CSP, RenderedBody, render_body};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use tauri::http::{Response, StatusCode, header};

use crate::commands::AppState;

const ENCODE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');
const CACHE_CAPACITY: usize = 16;

/// `mailbody://localhost/{id}?t=<term>&t=<term>...`, each term percent-encoded.
pub fn body_url(id: i64, terms: &[String]) -> String {
    let mut url = format!("mailbody://localhost/{id}");
    for (i, t) in terms.iter().enumerate() {
        url.push(if i == 0 { '?' } else { '&' });
        url.push_str("t=");
        url.extend(utf8_percent_encode(t, ENCODE));
    }
    url
}

fn decode(s: &str) -> Option<String> {
    percent_decode_str(s)
        .decode_utf8()
        .ok()
        .map(|c| c.into_owned())
}

fn parse_id(s: &str) -> Option<i64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok().filter(|id| *id > 0)
}

/// Inverse of [`body_url`], given the URL's path and query.
pub fn parse_body_uri(path: &str, query: Option<&str>) -> Option<(i64, Vec<String>)> {
    let id = parse_id(path.strip_prefix('/')?)?;
    let mut terms = Vec::new();
    if let Some(q) = query {
        for pair in q.split('&').filter(|p| !p.is_empty()) {
            terms.push(decode(pair.strip_prefix("t=")?)?);
        }
    }
    Some((id, terms))
}

/// `/{id}/{percent-encoded cid}`
pub fn parse_cid_uri(path: &str) -> Option<(i64, String)> {
    let (id, cid) = path.strip_prefix('/')?.split_once('/')?;
    let cid = decode(cid)?;
    if cid.is_empty() || cid.contains('/') {
        return None;
    }
    Some((parse_id(id)?, cid))
}

type CacheKey = (i64, Vec<String>);

/// Small LRU of rendered bodies keyed by (message id, terms). Most recent at
/// the back. Has its own lock, separate from the library's.
#[derive(Default)]
pub struct RenderCache {
    entries: Mutex<VecDeque<(CacheKey, Arc<RenderedBody>)>>,
}

impl RenderCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<(CacheKey, Arc<RenderedBody>)>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get(&self, id: i64, terms: &[String]) -> Option<Arc<RenderedBody>> {
        let mut e = self.lock();
        let pos = e.iter().position(|(k, _)| k.0 == id && k.1 == terms)?;
        let hit = e.remove(pos)?;
        let body = hit.1.clone();
        e.push_back(hit);
        Some(body)
    }

    pub fn put(&self, id: i64, terms: &[String], body: Arc<RenderedBody>) {
        let mut e = self.lock();
        e.retain(|(k, _)| !(k.0 == id && k.1 == terms));
        e.push_back(((id, terms.to_vec()), body));
        while e.len() > CACHE_CAPACITY {
            e.pop_front();
        }
    }

    pub fn clear(&self) {
        self.lock().clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().len()
    }
}

/// Render through the cache. The library lock is not held while rendering.
pub fn render_cached(state: &AppState, id: i64, raw: &[u8], terms: &[String]) -> Arc<RenderedBody> {
    if let Some(hit) = state.cache().get(id, terms) {
        return hit;
    }
    let body = Arc::new(render_body(raw, id, terms));
    state.cache().put(id, terms, body.clone());
    body
}

fn not_found() -> Response<Vec<u8>> {
    let mut r = Response::new(Vec::new());
    *r.status_mut() = StatusCode::NOT_FOUND;
    r
}

fn ok(content_type: &str, csp: Option<&str>, body: Vec<u8>) -> Response<Vec<u8>> {
    let mut b = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("X-Content-Type-Options", "nosniff");
    if let Some(csp) = csp {
        b = b.header("Content-Security-Policy", csp);
    }
    b.body(body).unwrap_or_else(|_| not_found())
}

pub fn serve_body(state: &AppState, path: &str, query: Option<&str>) -> Response<Vec<u8>> {
    let Some((id, terms)) = parse_body_uri(path, query) else {
        return not_found();
    };
    let body = match state.cache().get(id, &terms) {
        Some(b) => b,
        None => match state.raw(id) {
            Some(raw) => render_cached(state, id, &raw, &terms),
            None => return not_found(),
        },
    };
    ok(
        "text/html; charset=utf-8",
        Some(BODY_CSP),
        body.html.clone().into_bytes(),
    )
}

/// Raster image types only; SVG can carry script and is never served.
fn is_raster_image(mime: &str) -> bool {
    matches!(
        mime.to_ascii_lowercase().as_str(),
        "image/png"
            | "image/jpeg"
            | "image/jpg"
            | "image/pjpeg"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/avif"
    )
}

pub fn serve_cid(state: &AppState, path: &str) -> Response<Vec<u8>> {
    let Some((id, cid)) = parse_cid_uri(path) else {
        return not_found();
    };
    let Some((row, raw)) = state.message_and_raw(id) else {
        return not_found();
    };
    let Some(att) = row.attachments.iter().find(|a| {
        a.content_id
            .as_deref()
            .is_some_and(|c| c.trim().trim_start_matches('<').trim_end_matches('>') == cid)
    }) else {
        return not_found();
    };
    if !is_raster_image(&att.mime_type) {
        return not_found();
    }
    match mail_core::parse::attachment_bytes(&raw, att.part_index) {
        Some(bytes) => ok(&att.mime_type.to_ascii_lowercase(), None, bytes),
        None => not_found(),
    }
}

/// Run a handler, turning any panic into a 404.
pub fn guarded(f: impl FnOnce() -> Response<Vec<u8>>) -> Response<Vec<u8>> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|_| not_found())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::state_with;
    use mail_core::testing::MsgBuilder;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn body_url_roundtrip() {
        let terms = s(&["a b", "x&y=z", "é#?", "plain"]);
        let url = body_url(5, &terms);
        assert!(url.starts_with("mailbody://localhost/5?t=a%20b&t=x%26y%3Dz&t="));
        let rest = url.strip_prefix("mailbody://localhost").unwrap();
        let (path, q) = rest.split_once('?').unwrap();
        assert_eq!(parse_body_uri(path, Some(q)), Some((5, terms)));
        assert_eq!(body_url(9, &[]), "mailbody://localhost/9");
        assert_eq!(parse_body_uri("/9", None), Some((9, vec![])));
    }

    #[test]
    fn malformed_uris_rejected() {
        for p in [
            "",
            "/",
            "/abc",
            "/-1",
            "/0",
            "/1/2",
            "5",
            "/99999999999999999999",
        ] {
            assert_eq!(parse_body_uri(p, None), None, "{p}");
        }
        assert_eq!(parse_body_uri("/1", Some("x=1")), None);
        assert_eq!(parse_body_uri("/1", Some("t=%ff")), None);
        for p in ["", "/1", "/1/", "/x/a", "/1/a/b", "/1/%ff"] {
            assert_eq!(parse_cid_uri(p), None, "{p}");
        }
        assert_eq!(parse_cid_uri("/3/logo%40x"), Some((3, "logo@x".into())));
    }

    #[test]
    fn cache_evicts_beyond_16_and_hit_is_identical() {
        let c = RenderCache::default();
        let none: Vec<String> = vec![];
        for id in 1..=16 {
            c.put(
                id,
                &none,
                Arc::new(RenderedBody {
                    html: format!("h{id}"),
                    blocked_remote: 0,
                }),
            );
        }
        // Touch 1 so that 2 becomes the oldest.
        assert_eq!(c.get(1, &none).unwrap().html, "h1");
        c.put(
            17,
            &none,
            Arc::new(RenderedBody {
                html: "h17".into(),
                blocked_remote: 3,
            }),
        );
        assert_eq!(c.len(), 16);
        assert!(c.get(2, &none).is_none(), "oldest entry evicted");
        assert_eq!(c.get(1, &none).unwrap().html, "h1");
        let a = c.get(17, &none).unwrap();
        let b = c.get(17, &none).unwrap();
        assert_eq!((a.html.clone(), a.blocked_remote), (b.html.clone(), 3));
        // Different terms are a different key.
        assert!(c.get(17, &s(&["x"])).is_none());
    }

    #[test]
    fn body_and_cid_handlers() {
        let png = [0x89u8, b'P', b'N', b'G', 1, 2, 3];
        let (state, ids, _dir) = state_with(&[MsgBuilder::new()
            .from("a@example.com")
            .subject("Hi")
            .thrid(1)
            .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
            .message_id(Some("<1@x>"))
            .html("<p>Hello <img src=\"cid:logo\"> <img src=\"https://example.com/t.gif\"></p>")
            .inline_image("logo", &png)
            .attach("doc.pdf", "application/pdf", b"%PDF")]);
        let id = ids[0];

        let r = serve_body(&state, &format!("/{id}"), Some("t=hello"));
        assert_eq!(r.status(), 200);
        assert_eq!(r.headers()["content-security-policy"], BODY_CSP);
        assert_eq!(r.headers()["content-type"], "text/html; charset=utf-8");
        let html = String::from_utf8(r.into_body()).unwrap();
        assert!(html.contains("mailcid://localhost/"));
        assert!(!html.contains("example.com/t.gif"));
        // Second request is served from the cache with identical bytes.
        assert!(state.cache().get(id, &s(&["hello"])).is_some());
        let again = serve_body(&state, &format!("/{id}"), Some("t=hello"));
        assert_eq!(String::from_utf8(again.into_body()).unwrap(), html);

        assert_eq!(serve_body(&state, "/99999", None).status(), 404);
        assert_eq!(serve_body(&state, "/junk", None).status(), 404);

        let r = serve_cid(&state, &format!("/{id}/logo"));
        assert_eq!(r.status(), 200);
        assert_eq!(r.headers()["content-type"], "image/png");
        assert_eq!(r.into_body(), png);
        assert_eq!(serve_cid(&state, &format!("/{id}/nope")).status(), 404);
        assert_eq!(serve_cid(&state, "/bad").status(), 404);
        assert_eq!(serve_cid(&state, "/99999/logo").status(), 404);
    }

    #[test]
    fn only_raster_images_are_served() {
        assert!(!is_raster_image("image/svg+xml"));
        assert!(!is_raster_image("text/html"));
        assert!(!is_raster_image("application/pdf"));
        assert!(is_raster_image("IMAGE/PNG"));
        assert!(is_raster_image("image/jpeg"));
    }
}
