//! `mailbody://` and `mailcid://` handlers, the body URL format, and the
//! render cache. Every handler returns 404 on anything malformed and never
//! panics.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use mail_core::render::{BODY_CSP, RenderedBody, render_body};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use tauri::http::{Response, StatusCode, header};

use crate::commands::{AppState, Fetch};

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
    if cid.is_empty() {
        return None;
    }
    Some((parse_id(id)?, cid))
}

type CacheKey = (i64, Vec<String>);

#[derive(Default)]
struct CacheInner {
    /// Bumped by `clear`; inserts computed under an older generation are dropped.
    generation: u64,
    /// Most recent at the back.
    entries: VecDeque<(CacheKey, Arc<RenderedBody>)>,
}

/// Small LRU of rendered bodies keyed by (message id, terms). Has its own
/// lock, separate from the library's.
#[derive(Default)]
pub struct RenderCache {
    inner: Mutex<CacheInner>,
}

impl RenderCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, CacheInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    pub fn get(&self, id: i64, terms: &[String]) -> Option<Arc<RenderedBody>> {
        let mut c = self.lock();
        let pos = c
            .entries
            .iter()
            .position(|(k, _)| k.0 == id && k.1 == terms)?;
        let hit = c.entries.remove(pos)?;
        let body = hit.1.clone();
        c.entries.push_back(hit);
        Some(body)
    }

    /// Insert unless the cache was cleared since `generation` was read.
    pub fn put(&self, generation: u64, id: i64, terms: &[String], body: Arc<RenderedBody>) {
        let mut c = self.lock();
        if c.generation != generation {
            return;
        }
        c.entries.retain(|(k, _)| !(k.0 == id && k.1 == terms));
        c.entries.push_back(((id, terms.to_vec()), body));
        while c.entries.len() > CACHE_CAPACITY {
            c.entries.pop_front();
        }
    }

    pub fn clear(&self) {
        let mut c = self.lock();
        c.generation += 1;
        c.entries.clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().entries.len()
    }
}

/// Render through the cache. No library lock is held here.
pub fn render_cached(state: &AppState, id: i64, raw: &[u8], terms: &[String]) -> Arc<RenderedBody> {
    if let Some(hit) = state.cache().get(id, terms) {
        return hit;
    }
    let generation = state.cache().generation();
    let body = Arc::new(render_body(raw, id, terms));
    state.cache().put(generation, id, terms, body.clone());
    body
}

fn status_only(code: StatusCode) -> Response<Vec<u8>> {
    let mut r = Response::new(Vec::new());
    *r.status_mut() = code;
    r
}

fn not_found() -> Response<Vec<u8>> {
    status_only(StatusCode::NOT_FOUND)
}

/// 503 when the library is busy (an import or rebuild holds it), 500 on a
/// real failure, 404 otherwise.
fn fetch_failure(f: Fetch) -> Response<Vec<u8>> {
    match f {
        Fetch::Busy => status_only(StatusCode::SERVICE_UNAVAILABLE),
        Fetch::Failed => status_only(StatusCode::INTERNAL_SERVER_ERROR),
        Fetch::NotFound => not_found(),
    }
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
        // The library lock is held only for the raw fetch; rendering is outside it.
        None => match state.raw(id, false) {
            Ok(raw) => render_cached(state, id, &raw, &terms),
            Err(f) => return fetch_failure(f),
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
    let (row, raw) = match state.message_and_raw(id, false) {
        Ok(v) => v,
        Err(f) => return fetch_failure(f),
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
        for p in ["", "/1", "/1/", "/x/a", "/1/%ff"] {
            assert_eq!(parse_cid_uri(p), None, "{p}");
        }
        assert_eq!(parse_cid_uri("/3/logo%40x"), Some((3, "logo@x".into())));
        // core encodes a "/" inside a cid as %2F on purpose.
        assert_eq!(parse_cid_uri("/3/a%2Fb"), Some((3, "a/b".into())));
    }

    fn body(html: &str) -> Arc<RenderedBody> {
        Arc::new(RenderedBody {
            html: html.into(),
            blocked_remote: 0,
        })
    }

    #[test]
    fn cache_evicts_beyond_16_and_hit_is_identical() {
        let c = RenderCache::default();
        let g = c.generation();
        let none: Vec<String> = vec![];
        for id in 1..=16 {
            c.put(g, id, &none, body(&format!("h{id}")));
        }
        // Touch 1 so that 2 becomes the oldest.
        assert_eq!(c.get(1, &none).unwrap().html, "h1");
        c.put(
            g,
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
    fn stale_generation_inserts_are_dropped() {
        let c = RenderCache::default();
        let none: Vec<String> = vec![];
        let old = c.generation();
        c.put(old, 1, &none, body("kept until clear"));
        c.clear();
        assert!(c.get(1, &none).is_none());
        // A render that started before the clear must not repopulate it.
        c.put(old, 2, &none, body("stale"));
        assert!(c.get(2, &none).is_none());
        c.put(c.generation(), 3, &none, body("fresh"));
        assert_eq!(c.get(3, &none).unwrap().html, "fresh");
    }

    const PNG: [u8; 7] = [0x89, b'P', b'N', b'G', 1, 2, 3];

    #[test]
    fn body_and_cid_handlers() {
        let (state, ids, _dir) = state_with(&[MsgBuilder::new()
            .from("a@example.com")
            .subject("Hi")
            .thrid(1)
            .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
            .message_id(Some("<1@x>"))
            .html("<p>Hello <img src=\"cid:logo\"> <img src=\"https://example.com/t.gif\"></p>")
            .inline_image("logo", &PNG)
            .attach("doc.pdf", "application/pdf", b"%PDF")
            .build()]);
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
        assert_eq!(r.into_body(), PNG);
        assert_eq!(serve_cid(&state, &format!("/{id}/nope")).status(), 404);
        assert_eq!(serve_cid(&state, "/bad").status(), 404);
        assert_eq!(serve_cid(&state, "/99999/logo").status(), 404);
    }

    #[test]
    fn cid_with_slash_round_trips_through_render_and_serve() {
        let (state, ids, _dir) = state_with(&[MsgBuilder::new()
            .from("a@example.com")
            .subject("Slash")
            .thrid(1)
            .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
            .message_id(Some("<1@x>"))
            .html("<p><img src=\"cid:a/b\"></p>")
            .inline_image("a/b", &PNG)
            .build()]);
        let raw = state.raw(ids[0], true).unwrap();
        let html = render_body(&raw, ids[0], &[]).html;
        let start = html.find("mailcid://localhost").expect("cid url in html");
        let url = &html[start..];
        let url = &url[..url.find('"').unwrap()];
        assert!(url.contains("a%2Fb"), "{url}");
        let path = url.strip_prefix("mailcid://localhost").unwrap();
        let r = serve_cid(&state, path);
        assert_eq!(r.status(), 200, "{path}");
        assert_eq!(r.into_body(), PNG);
    }

    #[test]
    fn non_image_part_with_matching_content_id_is_404() {
        let raw = b"From: a@example.com\n\
To: b@example.com\n\
Subject: Odd\n\
Date: Mon, 01 Jun 2020 10:00:00 +0000\n\
Message-ID: <odd@x>\n\
MIME-Version: 1.0\n\
Content-Type: multipart/related; boundary=\"B\"\n\
\n\
--B\n\
Content-Type: text/html; charset=utf-8\n\
\n\
<p><img src=\"cid:doc\"></p>\n\
--B\n\
Content-Type: application/pdf; name=\"x.pdf\"\n\
Content-Disposition: inline; filename=\"x.pdf\"\n\
Content-ID: <doc>\n\
Content-Transfer-Encoding: 7bit\n\
\n\
%PDF-1.4\n\
--B--\n"
            .to_vec();
        let (state, ids, _dir) = state_with(&[raw]);
        let (row, _) = state.message_and_raw(ids[0], true).unwrap();
        assert_eq!(
            row.attachments
                .first()
                .and_then(|a| a.content_id.as_deref()),
            Some("doc"),
            "fixture must carry a matching Content-ID: {:?}",
            row.attachments
        );
        assert_eq!(serve_cid(&state, &format!("/{}/doc", ids[0])).status(), 404);
    }

    #[test]
    fn busy_library_gives_503_and_cache_still_serves() {
        let (state, ids, _dir) = state_with(&[MsgBuilder::new()
            .from("a@example.com")
            .subject("Busy")
            .thrid(1)
            .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
            .message_id(Some("<1@x>"))
            .text("hello")
            .build()]);
        let path = format!("/{}", ids[0]);
        let held = crate::commands::test_support::hold_lib_lock(&state);
        assert_eq!(serve_body(&state, &path, None).status(), 503);
        assert_eq!(serve_cid(&state, &format!("{path}/x")).status(), 503);
        drop(held);
        assert_eq!(serve_body(&state, &path, None).status(), 200);
        // Now cached: served even while the library is busy.
        let _held = crate::commands::test_support::hold_lib_lock(&state);
        assert_eq!(serve_body(&state, &path, None).status(), 200);
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
