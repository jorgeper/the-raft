//! Safe rendering of message bodies for the sandboxed reading-pane iframe.
//!
//! Pipeline (defense in depth, all email HTML is hostile):
//! 1. `ammonia` allowlist sanitize,
//! 2. `lol_html` rewrite pass: strips every URL that could fetch a remote
//!    resource (attributes, `style` attributes, `<style>` blocks), rewrites
//!    `cid:` URLs, hardens links, and highlights search terms,
//! 3. wrap in a document whose first `<head>` element is the CSP `<meta>`.
//!
//! The app additionally serves [`BODY_CSP`] as an HTTP header.

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::Rc;

use lol_html::html_content::{ContentType, TextType};
use lol_html::{RewriteStrSettings, doc_text, element, rewrite_str};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use crate::model::MsgId;
use crate::parse::{html_body, text_body};

/// Content-Security-Policy for the body iframe.
pub const BODY_CSP: &str =
    "default-src 'none'; style-src 'unsafe-inline'; img-src mailcid: data:; font-src data:";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RenderedBody {
    /// Full HTML document for the iframe.
    pub html: String,
    /// Number of remote fetches that were blocked (images, CSS urls, ...).
    pub blocked_remote: u32,
}

const DOC_STYLE: &str = "body{font:14px/1.45 -apple-system,BlinkMacSystemFont,\"Helvetica Neue\",Arial,sans-serif;\
margin:12px;word-wrap:break-word}img{max-width:100%;height:auto}\
mark{background:#ffe066;color:inherit}\
.ma-blocked-img{display:inline-block;min-width:16px;min-height:16px;\
background:#e4e4e7;border:1px dashed #a1a1aa;box-sizing:border-box;vertical-align:middle}";

/// Render the best body of a raw RFC 822 message as a safe HTML document.
pub fn render_body(raw: &[u8], msg_id: MsgId, terms: &[String]) -> RenderedBody {
    let terms = fold_terms(terms);
    let (inner, blocked) = if let Some(html) = html_body(raw) {
        // ammonia drops <body> (and its attributes) before the rewrite pass
        // can see them, so count its remote fetches here.
        let pre = count_body_fetches(&html, msg_id);
        let (inner, n) = rewrite(&sanitize(&html), msg_id, &terms);
        (inner, n + pre)
    } else if let Some(text) = text_body(raw) {
        let wrapped = format!(
            "<div style=\"white-space:pre-wrap\">{}</div>",
            linkify_escape(&text)
        );
        rewrite(&wrapped, msg_id, &terms)
    } else {
        (String::new(), 0)
    };
    RenderedBody {
        html: format!(
            "<!DOCTYPE html><html><head>\
             <meta http-equiv=\"Content-Security-Policy\" content=\"{BODY_CSP}\">\
             <meta charset=\"utf-8\"><style>{DOC_STYLE}</style></head><body>{inner}</body></html>"
        ),
        blocked_remote: blocked,
    }
}

/// Remote fetches declared on `<body>` (`background`, `style` urls). The
/// attributes are never emitted; this only keeps `blocked_remote` honest.
fn count_body_fetches(html: &str, msg_id: MsgId) -> u32 {
    if find_ci(html, "<body").is_none() {
        return 0;
    }
    let n = Rc::new(Cell::new(0u32));
    let n2 = n.clone();
    let settings =
        RewriteStrSettings::new().append_element_content_handler(element!("body", move |el| {
            if let Some(v) = el.get_attribute("background")
                && !v.trim().is_empty()
                && safe_resource(&v, msg_id).is_none()
            {
                n2.set(n2.get() + 1);
            }
            if let Some(st) = el.get_attribute("style") {
                let mut c = 0;
                sanitize_css(&unescape_text(&st), msg_id, &mut c);
                n2.set(n2.get() + c);
            }
            Ok(())
        }));
    let _ = rewrite_str(html, settings);
    n.get()
}

// ---------------------------------------------------------------------------
// Step 1: allowlist sanitize

fn sanitize(html: &str) -> String {
    let mut b = ammonia::Builder::default();
    b.add_tags([
        "style", "center", "font", "video", "audio", "source", "picture",
    ]);
    // Keep <style> and drop <title>, <script> with their content.
    b.rm_clean_content_tags(["style"]);
    b.add_clean_content_tags(["title"]);
    b.add_generic_attributes([
        "style", "class", "width", "height", "align", "valign", "bgcolor",
    ]);
    for t in ["table", "td", "th", "tr", "tbody", "thead"] {
        b.add_tag_attributes(
            t,
            [
                "background",
                "cellpadding",
                "cellspacing",
                "border",
                "colspan",
                "rowspan",
            ],
        );
    }
    b.add_tag_attributes("font", ["color", "face", "size"]);
    b.add_tag_attributes("img", ["srcset"]);
    b.add_tag_attributes("source", ["src", "srcset", "type"]);
    b.add_tag_attributes("video", ["src", "poster"]);
    b.add_tag_attributes("audio", ["src"]);
    b.url_schemes(
        ["http", "https", "mailto", "cid", "data"]
            .into_iter()
            .collect::<HashSet<_>>(),
    );
    b.link_rel(None);
    b.clean(html).to_string()
}

// ---------------------------------------------------------------------------
// Step 2: rewrite pass

/// Tags removed with their content regardless of what ammonia allowed.
const REMOVED_TAGS: &[&str] = &[
    "script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input",
    "button", "select", "textarea", "link", "meta", "base", "svg", "math", "template", "noscript",
    "canvas", "portal", "track", "title",
];

/// Attributes whose remote value is a fetch that is counted when blocked.
const FETCH_ATTRS: &[&str] = &[
    "src",
    "srcset",
    "background",
    "poster",
    "data",
    "lowsrc",
    "dynsrc",
];

/// Other URL-bearing attributes: always removed (never counted).
const OTHER_URL_ATTRS: &[&str] = &[
    "action",
    "formaction",
    "xlink:href",
    "longdesc",
    "ping",
    "cite",
    "manifest",
    "icon",
    "usemap",
    "codebase",
    "profile",
    "srcdoc",
    "href",
];

fn rewrite(html: &str, msg_id: MsgId, terms: &[Vec<char>]) -> (String, u32) {
    let blocked = Rc::new(Cell::new(0u32));

    let el_blocked = blocked.clone();
    // A <picture> with several blocked candidates is one blocked image.
    let in_picture = Rc::new(Cell::new(false));
    let pic_counted = Rc::new(Cell::new(false));
    let text_blocked = blocked.clone();
    let buf = RefCell::new(String::new());
    let terms: Vec<Vec<char>> = terms.to_vec();

    let settings = RewriteStrSettings::new()
        .append_element_content_handler(element!("*", move |el| {
            let tag = el.tag_name().to_ascii_lowercase();
            if REMOVED_TAGS.contains(&tag.as_str()) {
                el.remove();
                return Ok(());
            }
            // Event handlers and anything else dangerous by name.
            let names: Vec<String> = el.attributes().iter().map(|a| a.name()).collect();
            for n in &names {
                if n.starts_with("on") {
                    el.remove_attribute(n);
                }
            }

            if tag == "picture" {
                in_picture.set(true);
                pic_counted.set(false);
                let ip = in_picture.clone();
                let h: Box<
                    dyn for<'a, 'b> FnOnce(&'a mut lol_html::html_content::EndTag<'b>) -> lol_html::HandlerResult,
                > = Box::new(move |_| {
                    ip.set(false);
                    Ok(())
                });
                el.on_end_tag(h)?;
            }
            let count_fetch = |n_if_free: u32| {
                if in_picture.get() && (tag == "img" || tag == "source") {
                    if !pic_counted.get() {
                        pic_counted.set(true);
                        el_blocked.set(el_blocked.get() + n_if_free);
                    }
                } else {
                    el_blocked.set(el_blocked.get() + n_if_free);
                }
            };

            if tag == "video" || tag == "audio" {
                for a in ["poster", "src"] {
                    if el.get_attribute(a).is_some_and(|v| !v.trim().is_empty()) {
                        el_blocked.set(el_blocked.get() + 1);
                    }
                }
                el.remove();
                return Ok(());
            }

            if tag == "a" {
                // The tooltip shows where a link really goes (WKWebView has no
                // status bar): always the validated href, never the sender's title.
                match el.get_attribute("href").as_deref().and_then(safe_link) {
                    Some(h) => {
                        el.set_attribute("href", &h)?;
                        el.set_attribute("title", &h)?;
                        el.set_attribute("target", "_blank")?;
                        el.set_attribute("rel", "noopener noreferrer")?;
                    }
                    None => {
                        el.remove_attribute("href");
                        el.remove_attribute("title");
                        el.remove_attribute("target");
                        el.remove_attribute("rel");
                    }
                }
            }
            for a in OTHER_URL_ATTRS {
                if !(tag == "a" && *a == "href") {
                    el.remove_attribute(a);
                }
            }
            el.remove_attribute("data-src");

            // Fetching attributes.
            let mut img_blocked = false;
            let mut img_src_ok = false;
            for a in FETCH_ATTRS {
                let Some(v) = el.get_attribute(a) else { continue };
                let ok = if *a == "srcset" {
                    rewrite_srcset(&v, msg_id)
                } else {
                    safe_resource(&v, msg_id)
                };
                match ok {
                    Some(nv) => {
                        el.set_attribute(a, &nv)?;
                        if *a == "src" {
                            img_src_ok = true;
                        }
                    }
                    None => {
                        el.remove_attribute(a);
                        if v.trim().is_empty() {
                            continue;
                        }
                        if tag == "img" {
                            img_blocked = true;
                        } else {
                            count_fetch(1);
                        }
                    }
                }
            }
            if tag == "img" {
                if img_blocked {
                    count_fetch(1);
                }
                if img_blocked || !img_src_ok && el.get_attribute("srcset").is_none() {
                    if img_blocked {
                        let dim = |n: &str| {
                            el.get_attribute(n)
                                .map(|v| v.trim().to_string())
                                .filter(|v| {
                                    !v.is_empty() && v.len() <= 4 && v.bytes().all(|b| b.is_ascii_digit())
                                })
                        };
                        let mut style = String::new();
                        if let Some(w) = dim("width") {
                            style += &format!("width:{w}px;");
                        }
                        if let Some(h) = dim("height") {
                            style += &format!("height:{h}px;");
                        }
                        let s = if style.is_empty() {
                            String::new()
                        } else {
                            format!(" style=\"{style}\"")
                        };
                        el.replace(
                            &format!(
                                "<span class=\"ma-blocked-img\" title=\"Remote image blocked\"{s}></span>"
                            ),
                            ContentType::Html,
                        );
                    } else {
                        el.remove();
                    }
                    return Ok(());
                }
            }

            if let Some(style) = el.get_attribute("style") {
                // lol_html hands out the raw (entity-encoded) attribute text
                // and does not escape `&` on write: decode before vetting so
                // the vetter sees what the browser sees, then re-encode.
                let mut n = 0;
                let clean = sanitize_css(&unescape_text(&style), msg_id, &mut n);
                el_blocked.set(el_blocked.get() + n);
                if clean.trim().is_empty() {
                    el.remove_attribute("style");
                } else {
                    el.set_attribute("style", &escape_attr_and_text(&clean))?;
                }
            }
            Ok(())
        }))
        .append_document_content_handler(doc_text!(move |t| {
            // Buffer the whole text node: it may arrive in several chunks.
            let ty = t.text_type();
            let mut b = buf.borrow_mut();
            b.push_str(t.as_str());
            t.remove();
            if !t.last_in_text_node() {
                return Ok(());
            }
            let raw = std::mem::take(&mut *b);
            match ty {
                TextType::Data => match highlight(&raw, &terms) {
                    Some(h) => t.replace(&h, ContentType::Html),
                    None => t.replace(&raw, ContentType::Html),
                },
                TextType::RawText => {
                    let mut n = 0;
                    let css = sanitize_css(&raw, msg_id, &mut n);
                    text_blocked.set(text_blocked.get() + n);
                    t.replace(&css, ContentType::Html);
                }
                // RCDATA (title, textarea) is kept verbatim, never highlighted;
                // script data / plaintext / CDATA are dropped.
                TextType::RCData => t.replace(&raw, ContentType::Html),
                _ => {}
            }
            Ok(())
        }));

    match rewrite_str(html, settings) {
        Ok(out) => (out, blocked.get()),
        // Fail closed: never emit unrewritten markup.
        Err(_) => (String::new(), 0),
    }
}

// ---------------------------------------------------------------------------
// URL policy

fn strip_ctl(v: &str) -> String {
    v.chars()
        .filter(|c| !c.is_control() && !c.is_whitespace())
        .collect()
}

/// `href` of an `<a>`: only http, https, mailto survive.
fn safe_link(v: &str) -> Option<String> {
    let s = strip_ctl(v).to_ascii_lowercase();
    if s.starts_with("http://") || s.starts_with("https://") || s.starts_with("mailto:") {
        Some(v.trim().to_string())
    } else {
        None
    }
}

/// A resource URL (img src, background, ...): only `cid:` (rewritten) and
/// raster `data:` images are allowed.
fn safe_resource(v: &str, msg_id: MsgId) -> Option<String> {
    let s = v.trim();
    let lower = strip_ctl(s).to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("cid:") {
        if rest.is_empty() {
            return None;
        }
        // Use the original text (case preserved) after the scheme.
        let orig = strip_ctl(s);
        return Some(cid_url(msg_id, &orig[4..]));
    }
    if is_safe_data_image(&lower) {
        return Some(strip_ctl(s));
    }
    None
}

fn is_safe_data_image(lower: &str) -> bool {
    let Some(rest) = lower.strip_prefix("data:image/") else {
        return false;
    };
    let mime: String = rest
        .chars()
        .take_while(|c| *c != ';' && *c != ',')
        .collect();
    matches!(mime.as_str(), "png" | "gif" | "jpeg" | "webp") && rest.len() > mime.len()
}

/// srcset: allowed only when every candidate is a `cid:` URL.
fn rewrite_srcset(v: &str, msg_id: MsgId) -> Option<String> {
    let mut parts = Vec::new();
    for cand in v.split(',') {
        let mut it = cand.split_whitespace();
        let url = it.next()?;
        if !url.to_ascii_lowercase().starts_with("cid:") {
            return None;
        }
        let u = safe_resource(url, msg_id)?;
        let rest: Vec<&str> = it.collect();
        parts.push(if rest.is_empty() {
            u
        } else {
            format!("{u} {}", rest.join(" "))
        });
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(", "))
    }
}

fn cid_url(msg_id: MsgId, cid: &str) -> String {
    let decoded = percent_decode(cid.trim());
    let decoded = decoded.trim().trim_start_matches('<').trim_end_matches('>');
    format!(
        "mailcid://localhost/{msg_id}/{}",
        percent_encode_strict(decoded)
    )
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && let (Some(h), Some(l)) = (
                b.get(i + 1).and_then(|c| (*c as char).to_digit(16)),
                b.get(i + 2).and_then(|c| (*c as char).to_digit(16)),
            )
        {
            out.push((h * 16 + l) as u8);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode everything except RFC 3986 unreserved characters.
fn percent_encode_strict(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

// ---------------------------------------------------------------------------
// CSS sanitizing

/// Optionally remove comments, decode CSS escapes (once, exactly as a browser would),
/// then drop whitespace between a function name and its `(`.
fn css_normalize(s: &str, strip_comments: bool) -> String {
    // Strip comments (the raw text is vetted as well, see `css_chunk_unsafe`).
    let mut nc = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if strip_comments && c == '/' && it.peek() == Some(&'*') {
            it.next();
            let mut prev = '\0';
            for d in it.by_ref() {
                if prev == '*' && d == '/' {
                    break;
                }
                prev = d;
            }
        } else {
            nc.push(c);
        }
    }
    // Decode escapes.
    let cs: Vec<char> = nc.chars().collect();
    let mut dec = String::with_capacity(cs.len());
    let mut i = 0;
    while i < cs.len() {
        if cs[i] == '\\' && i + 1 < cs.len() {
            if cs[i + 1].is_ascii_hexdigit() {
                let mut j = i + 1;
                let mut v: u32 = 0;
                while j < cs.len() && j < i + 7 && cs[j].is_ascii_hexdigit() {
                    v = v * 16 + cs[j].to_digit(16).unwrap_or(0);
                    j += 1;
                }
                if j < cs.len() && cs[j].is_whitespace() {
                    j += 1;
                }
                dec.push(
                    char::from_u32(v)
                        .filter(|c| *c != '\0')
                        .unwrap_or('\u{fffd}'),
                );
                i = j;
            } else {
                dec.push(cs[i + 1]);
                i += 2;
            }
        } else {
            dec.push(cs[i]);
            i += 1;
        }
    }
    // Lowercase, drop control chars, and collapse whitespace before `(`.
    let lower: String = dec
        .chars()
        .filter(|c| !c.is_control() || c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect();
    let mut out = String::with_capacity(lower.len());
    let lc: Vec<char> = lower.chars().collect();
    let mut k = 0;
    while k < lc.len() {
        if lc[k].is_whitespace() {
            let mut m = k;
            while m < lc.len() && lc[m].is_whitespace() {
                m += 1;
            }
            if m < lc.len() && lc[m] == '(' {
                k = m;
                continue;
            }
            out.push(' ');
            k = m;
            continue;
        }
        out.push(lc[k]);
        k += 1;
    }
    out
}

/// Vet a raw chunk both with comments stripped and with comments left in
/// place: the splitter's string tracking is not a full CSS tokenizer, so a
/// comment marker inside a string must not be able to hide a `url(` from
/// the vetter. The chunk is dropped if either view is unsafe.
fn css_chunk_unsafe(chunk: &str) -> Option<u32> {
    let a = css_chunk_verdict(&css_normalize(chunk, true));
    let b = css_chunk_verdict(&css_normalize(chunk, false));
    match (a, b) {
        (None, None) => None,
        (x, y) => Some(x.unwrap_or(0).max(y.unwrap_or(0))),
    }
}

/// Number of blocked fetches in a normalized CSS chunk, or `None` when the
/// chunk is safe. Anything suspicious yields at least `Some(0)` (dropped
/// without counting) or `Some(n)`.
fn css_chunk_verdict(norm: &str) -> Option<u32> {
    let mut n = 0u32;
    let mut bad = false;
    let mut rest = norm;
    while let Some(p) = rest.find("url(") {
        let after = rest[p + 4..].trim_start();
        let after = after.trim_start_matches(['"', '\'']).trim_start();
        if !(after.starts_with("cid:") || is_safe_css_data(after)) {
            n += 1;
            bad = true;
        }
        rest = &rest[p + 4..];
    }
    if norm.contains("@import") {
        bad = true;
        n = n.max(1);
    }
    for f in [
        "image-set(",
        "cross-fade(",
        "image(",
        "element(",
        "paint(",
        "src(",
        "expression(",
        "-moz-binding",
        "behavior:",
        "javascript:",
    ] {
        if norm.contains(f) {
            bad = true;
            n = n.max(u32::from(
                f.ends_with('(') && f != "expression(" && f != "src(",
            ));
        }
    }
    bad.then_some(n)
}

fn is_safe_css_data(s: &str) -> bool {
    is_safe_data_image(s)
        || s.starts_with("data:font/")
        || s.starts_with("data:application/font")
        || s.starts_with("data:application/x-font")
        || s.starts_with("data:application/vnd.ms-fontobject")
}

/// Rewrite plain `url(cid:...)` references in an already-vetted chunk.
fn rewrite_css_cids(chunk: &str, msg_id: MsgId) -> String {
    let lower = chunk.to_ascii_lowercase();
    let mut out = String::with_capacity(chunk.len());
    let mut pos = 0;
    while let Some(p) = lower[pos..].find("url(") {
        let start = pos + p;
        let mut i = start + 4;
        let bytes = chunk.as_bytes();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let quote = bytes.get(i).copied().filter(|b| *b == b'"' || *b == b'\'');
        if quote.is_some() {
            i += 1;
        }
        if lower[i..].starts_with("cid:") {
            let end = chunk[i..]
                .find(|c: char| c == ')' || c == '"' || c == '\'' || c.is_whitespace())
                .map_or(chunk.len(), |e| i + e);
            out.push_str(&chunk[pos..start]);
            out.push_str(&format!("url(\"{}\"", cid_url(msg_id, &chunk[i + 4..end])));
            pos = if quote.is_some() && chunk[end..].starts_with(['"', '\'']) {
                end + 1
            } else {
                end
            };
            continue;
        }
        out.push_str(&chunk[pos..start + 4]);
        pos = start + 4;
    }
    out.push_str(&chunk[pos..]);
    out
}

/// Split CSS at `;`, `{`, `}` (outside strings and parentheses) and vet every
/// piece independently. Delimiters are kept.
fn sanitize_css(css: &str, msg_id: MsgId, blocked: &mut u32) -> String {
    let mut out = String::with_capacity(css.len());
    let mut chunk = String::new();
    let mut quote: Option<char> = None;
    let mut depth = 0u32;
    let mut esc = false;
    let flush = |chunk: &mut String, delim: Option<char>, out: &mut String, blocked: &mut u32| {
        if !chunk.is_empty() {
            match css_chunk_unsafe(chunk) {
                None => out.push_str(&rewrite_css_cids(chunk, msg_id)),
                Some(n) => *blocked += n,
            }
            chunk.clear();
        }
        if let Some(d) = delim {
            out.push(d);
        }
    };
    for c in css.chars() {
        if let Some(q) = quote {
            chunk.push(c);
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => {
                quote = Some(c);
                chunk.push(c);
            }
            '(' => {
                depth += 1;
                chunk.push(c);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                chunk.push(c);
            }
            ';' | '{' | '}' if depth == 0 => {
                flush(&mut chunk, Some(c), &mut out, blocked);
            }
            // `<` could never appear raw in a style element; neutralize anyway.
            '<' => chunk.push_str("\\3c "),
            _ => chunk.push(c),
        }
    }
    flush(&mut chunk, None, &mut out, blocked);
    out
}

// ---------------------------------------------------------------------------
// Highlighting

fn fold_char(c: char) -> impl Iterator<Item = char> {
    std::iter::once(c)
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(|c| c.to_lowercase().collect::<Vec<_>>())
}

fn fold_terms(terms: &[String]) -> Vec<Vec<char>> {
    terms
        .iter()
        .map(|t| t.trim().chars().flat_map(fold_char).collect::<Vec<char>>())
        .filter(|t| !t.is_empty())
        .collect()
}

fn unescape_text(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        let Some(semi) = rest.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..semi];
        let rep = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            _ => ent
                .strip_prefix('#')
                .and_then(|n| {
                    if let Some(h) = n.strip_prefix(['x', 'X']) {
                        u32::from_str_radix(h, 16).ok()
                    } else {
                        n.parse().ok()
                    }
                })
                .and_then(char::from_u32),
        };
        match rep {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn escape_text(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
}

/// Wrap matches in `<mark>`; `None` when nothing matches. `raw` is the
/// HTML-escaped text of a text node; the result is HTML-escaped too.
fn highlight(raw: &str, terms: &[Vec<char>]) -> Option<String> {
    if terms.is_empty() || raw.trim().is_empty() {
        return None;
    }
    let text = unescape_text(raw);
    let mut folded: Vec<char> = Vec::with_capacity(text.len());
    // Per folded char: index of the originating char.
    let mut origin: Vec<usize> = Vec::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        for f in fold_char(*c) {
            folded.push(f);
            origin.push(i);
        }
    }
    let mut spans: Vec<(usize, usize)> = Vec::new(); // in original char indices, end exclusive
    for t in terms {
        if t.len() > folded.len() {
            continue;
        }
        let first = t[0];
        let mut i = 0;
        while i + t.len() <= folded.len() {
            if folded[i] == first && folded[i..i + t.len()] == t[..] {
                spans.push((origin[i], origin[i + t.len() - 1] + 1));
                i += t.len();
            } else {
                i += 1;
            }
        }
    }
    if spans.is_empty() {
        return None;
    }
    spans.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (s, e) in spans {
        match merged.last_mut() {
            Some(l) if s <= l.1 => l.1 = l.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    let mut out = String::with_capacity(text.len() + merged.len() * 13);
    let mut pos = 0;
    let slice = |a: usize, b: usize| chars[a..b].iter().collect::<String>();
    for (s, e) in merged {
        escape_text(&slice(pos, s), &mut out);
        out.push_str("<mark>");
        escape_text(&slice(s, e), &mut out);
        out.push_str("</mark>");
        pos = e;
    }
    escape_text(&slice(pos, chars.len()), &mut out);
    Some(out)
}

// ---------------------------------------------------------------------------
// Plain text

fn escape_attr_and_text(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            _ => o.push(c),
        }
    }
    o
}

/// HTML-escape plain text and turn http(s) URLs into links.
fn linkify_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + text.len() / 4);
    let mut rest = text;
    loop {
        let next = ["http://", "https://"]
            .iter()
            .filter_map(|p| find_ci(rest, p))
            .min();
        let Some(start) = next else {
            out.push_str(&escape_attr_and_text(rest));
            break;
        };
        out.push_str(&escape_attr_and_text(&rest[..start]));
        let tail = &rest[start..];
        let mut end = tail
            .find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"'))
            .unwrap_or(tail.len());
        // Trim trailing punctuation (and unbalanced closing brackets).
        while end > 0 {
            let last = tail[..end].chars().next_back().unwrap_or(' ');
            let trim = match last {
                '.' | ',' | ';' | ':' | '!' | '?' | '\'' => true,
                ')' => tail[..end].matches('(').count() < tail[..end].matches(')').count(),
                ']' => tail[..end].matches('[').count() < tail[..end].matches(']').count(),
                '}' => tail[..end].matches('{').count() < tail[..end].matches('}').count(),
                _ => false,
            };
            if !trim {
                break;
            }
            end -= last.len_utf8();
        }
        let url = &tail[..end];
        if url.len() > "https://".len() {
            let e = escape_attr_and_text(url);
            out.push_str(&format!(
                "<a href=\"{e}\" title=\"{e}\" target=\"_blank\" rel=\"noopener noreferrer\">{e}</a>"
            ));
            rest = &tail[end..];
        } else {
            out.push_str(&escape_attr_and_text(&tail[..1]));
            rest = &tail[1..];
        }
    }
    out
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if h.len() < n.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MsgBuilder;
    use lol_html::{RewriteStrSettings, element, rewrite_str, text};
    use regex::Regex;
    use std::cell::RefCell;

    fn html_msg(html: &str) -> Vec<u8> {
        MsgBuilder::new().html(html).build()
    }

    fn render(html: &str) -> RenderedBody {
        render_body(&html_msg(html), 7, &[])
    }

    fn render_terms(html: &str, terms: &[&str]) -> RenderedBody {
        let t: Vec<String> = terms.iter().map(|s| s.to_string()).collect();
        render_body(&html_msg(html), 7, &t)
    }

    /// Brief regex checks plus a structural scan with lol_html over attributes,
    /// `style` attributes and `<style>` text.
    fn assert_no_remote(out: &str, what: &str) {
        let attr =
            Regex::new(r#"(?i)(src|srcset|background|poster)\s*=\s*["']?(https?:)?//"#).unwrap();
        let url = Regex::new(r#"(?i)url\(\s*["']?(https?:)?//"#).unwrap();
        assert!(!attr.is_match(out), "attr regex hit for {what}: {out}");
        assert!(!url.is_match(out), "url() regex hit for {what}: {out}");

        let remote = |v: &str| {
            let s: String = v
                .chars()
                .filter(|c| !c.is_whitespace() && !c.is_control())
                .collect();
            let s = s.to_ascii_lowercase();
            s.starts_with("http:")
                || s.starts_with("https:")
                || s.starts_with("//")
                || s.starts_with("ftp:")
                || s.contains("http://")
                || s.contains("https://")
        };
        let css_bad = |css: &str| {
            let n = css_normalize(css, true) + &css_normalize(css, false);
            n.contains("@import")
                || n.contains("image-set(")
                || n.contains("http:")
                || n.contains("https:")
                || n.contains("url(//")
                || n.contains("url(\"//")
                || n.contains("url('//")
        };
        let problems = RefCell::new(Vec::<String>::new());
        let style_text = RefCell::new(String::new());
        let first_head_child = RefCell::new(Vec::<String>::new());
        rewrite_str(
            out,
            RewriteStrSettings::new()
                .append_element_content_handler(element!("*", |el| {
                    let tag = el.tag_name();
                    if ["head", "html", "body", "meta", "style"].contains(&tag.as_str()) {
                        first_head_child.borrow_mut().push(tag.clone());
                    }
                    for a in el.attributes() {
                        let n = a.name();
                        let v = a.value();
                        let fetchy = matches!(
                            n.as_str(),
                            "src"
                                | "srcset"
                                | "background"
                                | "poster"
                                | "data"
                                | "action"
                                | "formaction"
                                | "xlink:href"
                                | "lowsrc"
                                | "dynsrc"
                                | "srcdoc"
                        ) || (n == "href" && tag != "a")
                            || (tag == "meta"
                                && n == "content"
                                && v.to_lowercase().contains("url"));
                        if fetchy && remote(&v) {
                            problems.borrow_mut().push(format!("<{tag} {n}={v}>"));
                        }
                        if n == "href" && tag == "a" {
                            let l = v.to_lowercase();
                            if !(l.starts_with("http://")
                                || l.starts_with("https://")
                                || l.starts_with("mailto:"))
                            {
                                problems.borrow_mut().push(format!("bad link {v}"));
                            }
                        }
                        if n == "style" && css_bad(&v) {
                            problems.borrow_mut().push(format!("style attr {v}"));
                        }
                        if n.starts_with("on") {
                            problems.borrow_mut().push(format!("handler {n}"));
                        }
                    }
                    if [
                        "script", "iframe", "object", "embed", "link", "base", "form", "svg",
                        "video", "audio",
                    ]
                    .contains(&tag.as_str())
                    {
                        problems.borrow_mut().push(format!("element <{tag}>"));
                    }
                    Ok(())
                }))
                .append_element_content_handler(text!("style", |t| {
                    style_text.borrow_mut().push_str(t.as_str());
                    Ok(())
                })),
        )
        .unwrap();
        let st = style_text.borrow();
        assert!(!css_bad(&st), "style block bad for {what}: {st}");
        assert!(
            problems.borrow().is_empty(),
            "{what}: {:?}\n{out}",
            problems.borrow()
        );
        // Only our own CSP meta is allowed, and it must come first in <head>.
        let head = out.find("<head>").unwrap();
        assert!(
            out[head + 6..].starts_with("<meta http-equiv=\"Content-Security-Policy\""),
            "CSP meta must be first in head"
        );
        assert_eq!(
            out.matches("<meta").count(),
            2,
            "{what}: unexpected meta in {out}"
        );
    }

    #[test]
    fn strips_active_content() {
        let html = r#"<p onclick="x()">hi</p><script>alert(1)</script><iframe src="cid:a"></iframe>
        <object data="cid:a"></object><form action="x"><input name=a></form>
        <meta http-equiv="refresh" content="0;url=https://evil.example/">
        <link rel="stylesheet" href="https://evil.example/a.css">
        <style>@import url(https://evil.example/b.css); p{color:red}</style>
        <a href="javascript:alert(1)">j</a><a href="  JaVa&#x09;script:alert(1)">j2</a>
        <a href="data:text/html,x">d</a><a href="vbscript:x">v</a><a href="file:///etc/passwd">f</a>"#;
        let out = render(html).html;
        for bad in [
            "<script",
            "alert(",
            "onclick",
            "<iframe",
            "<object",
            "<form",
            "<input",
            "refresh",
            "<link",
            "@import",
            "javascript:",
            "vbscript:",
            "file:",
            "data:text",
        ] {
            assert!(!out.to_lowercase().contains(bad), "{bad} in {out}");
        }
        assert!(out.contains("color:red"));
        assert_no_remote(&out, "active content");
    }

    #[test]
    fn no_remote_references() {
        let html = r#"<img src=https://t.co/p.gif width=1 height=1>
        <table background="http://evil.example/bg.png"><tr><td>x</td></tr></table>
        <div style="background:url(http://evil.example/s.png)">s</div>
        <img srcset="https://evil.example/a.png 1x, https://evil.example/b.png 2x">
        <video poster="https://evil.example/p.png"></video>"#;
        let r = render(html);
        assert_no_remote(&r.html, "brief sample");
        assert_eq!(r.blocked_remote, 5, "{}", r.html);
        assert_eq!(
            r.html.matches("class=\"ma-blocked-img\"").count(),
            2,
            "{}",
            r.html
        );
    }

    #[test]
    fn placeholder_sized_from_attrs() {
        let r = render(r#"<img src="http://x.example/a.gif" width="120" height="40">"#);
        assert!(r.html.contains("class=\"ma-blocked-img\""));
        assert!(r.html.contains("width:120px;height:40px;"), "{}", r.html);
        assert_eq!(r.blocked_remote, 1);
        assert_no_remote(&r.html, "sized");
    }

    #[test]
    fn cid_rewritten() {
        let r = render(
            r#"<img src="cid:logo@x"><img src="CID:%3Cb%20c%3E"><table><tr><td background="cid:bg">x</td></tr></table>"#,
        );
        assert!(
            r.html.contains("mailcid://localhost/7/logo%40x"),
            "{}",
            r.html
        );
        assert!(r.html.contains("mailcid://localhost/7/b%20c"), "{}", r.html);
        assert!(
            r.html.contains("background=\"mailcid://localhost/7/bg\""),
            "{}",
            r.html
        );
        assert_eq!(r.blocked_remote, 0);
        let c = render(r#"<div style="background:url('cid:a/b')">x</div>"#);
        assert!(c.html.contains("mailcid://localhost/7/a%2Fb"), "{}", c.html);
    }

    #[test]
    fn data_images_only_raster() {
        let ok = render(r#"<img src="data:image/png;base64,iVBORw0KGgo=">"#);
        assert!(ok.html.contains("data:image/png;base64,iVBORw0KGgo="));
        for bad in [
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:text/html,<b>x</b>",
            "data:image/svg+xml,%3Csvg%3E",
        ] {
            let r = render(&format!(r#"<img src="{bad}">"#));
            assert!(
                !r.html.contains("data:image/svg") && !r.html.contains("data:text"),
                "{}",
                r.html
            );
        }
    }

    #[test]
    fn links_kept_for_click() {
        let r = render(
            r#"<a href="https://example.com/x?a=1&b=2">go</a><a href="mailto:a@b.example">m</a>"#,
        );
        assert!(
            r.html
                .contains(r#"href="https://example.com/x?a=1&amp;b=2""#),
            "{}",
            r.html
        );
        assert!(r.html.contains(r#"target="_blank""#));
        assert!(r.html.contains(r#"rel="noopener noreferrer""#));
        assert!(r.html.contains(r#"href="mailto:a@b.example""#));
    }

    #[test]
    fn csp_meta_first_in_head() {
        let r = render("<p>x</p>");
        assert!(r.html.starts_with(&format!(
            "<!DOCTYPE html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"{BODY_CSP}\">"
        )));
    }

    #[test]
    fn highlights_terms() {
        let r = render_terms(
            r#"<p title="delta">Delta and <b>del</b>ta, déltà <a href="https://x.example/delta">DELTA</a></p>
            <style>.delta{color:red}</style>"#,
            &["delta"],
        );
        assert!(r.html.contains("<mark>Delta</mark> and"), "{}", r.html);
        assert!(r.html.contains("<mark>déltà</mark>"), "{}", r.html);
        assert!(r.html.contains("<mark>DELTA</mark></a>"));
        assert!(r.html.contains(r#"title="delta""#));
        assert!(r.html.contains(r#"href="https://x.example/delta""#));
        assert!(r.html.contains(".delta{color:red}"));
        assert!(!r.html.contains("<mark>del</mark>"));
    }

    #[test]
    fn highlight_escapes_and_multichunk() {
        // `a < b & delta` : text with entities stays escaped around the mark.
        let r = render_terms(
            "<p>a &lt;script&gt; &amp; delta</p>",
            &["delta", "<script>"],
        );
        assert!(
            r.html
                .contains("a <mark>&lt;script&gt;</mark> &amp; <mark>delta</mark>"),
            "{}",
            r.html
        );
        assert!(!r.html.contains("<script>"));
        // Multi-word term and a term straddling very long text (chunking).
        let long = format!("{}needle in {}", "x".repeat(70_000), "y".repeat(70_000));
        let r = render_terms(&format!("<p>{long}</p>"), &["needle in"]);
        assert!(r.html.contains("<mark>needle in</mark>"));
        let hay = format!("{}ne", "x".repeat(70_000));
        let r = render_terms(&format!("<p>{hay}edle</p>"), &["xnee"]);
        assert!(r.html.contains("<mark>xnee</mark>dle"), "multi-chunk term");
    }

    #[test]
    fn plain_text_escaped_and_linkified() {
        let raw = MsgBuilder::new()
            .text("Hi <b>there</b> & see https://example.com/a?x=1&y=2, or (http://foo.example/bar).\nline2 \"q\" <script>x</script>\njavascript:alert(1)")
            .build();
        let r = render_body(&raw, 1, &["line2".to_string()]);
        assert!(r.html.contains("white-space:pre-wrap"));
        assert!(
            r.html.contains("&lt;b&gt;there&lt;/b&gt; &amp; see"),
            "{}",
            r.html
        );
        assert!(r.html.contains(r#"<a href="https://example.com/a?x=1&amp;y=2" title="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">https://example.com/a?x=1&amp;y=2</a>,"#), "{}", r.html);
        assert!(r.html.contains(r#"href="http://foo.example/bar""#));
        assert!(r.html.contains("<mark>line2</mark>"));
        assert!(!r.html.contains("<script>"));
        assert!(!r.html.contains("<b>"));
        assert!(r.html.contains('\n'));
    }

    #[test]
    fn no_body_renders_empty_document() {
        let raw = b"From: a@example.com\nSubject: x\n\n".to_vec();
        let r = render_body(&raw, 1, &[]);
        assert!(
            r.html.contains("<body></body>") || r.html.contains("<body><div"),
            "{}",
            r.html
        );
    }

    #[test]
    fn huge_html_ok() {
        let row = "<p style=\"color:#333\">Lorem ipsum <b>dolor</b> sit amet, <a href=\"https://example.com/x\">link</a> consectetur adipiscing elit.</p>\n";
        let mut html = String::new();
        while html.len() < 5 * 1024 * 1024 {
            html.push_str(row);
        }
        let raw = html_msg(&html);
        let t = std::time::Instant::now();
        let r = render_body(&raw, 1, &["dolor".to_string()]);
        let el = t.elapsed();
        assert!(r.html.contains("<mark>dolor</mark>"));
        eprintln!("huge_html_ok: {el:?}");
        // The spec target is reading-pane latency; this bound only guards
        // against gross regressions, so it is release-only and generous.
        if !cfg!(debug_assertions) {
            assert!(el.as_millis() < 1000, "took {el:?}");
        }
    }

    #[test]
    fn css_obfuscations_dropped() {
        let cases = [
            r#"<div style="background:URL(http://e.example/a)">x</div>"#,
            "<div style=\"background:url (\n 'http://e.example/a')\">x</div>",
            r#"<div style="background:\75 rl(http://e.example/a)">x</div>"#,
            r#"<div style="background:u\72l(//e.example/a)">x</div>"#,
            r#"<div style="background:url(//e.example/a)">x</div>"#,
            r#"<div style="background:url(  &quot;//e.example/a&quot;)">x</div>"#,
            r#"<div style="background:u/**/rl(http://e.example/a)">x</div>"#,
            r#"<div style="background-image:image-set('http://e.example/a' 1x)">x</div>"#,
            r#"<div style="background:-webkit-image-set(url(http://e.example/a) 1x)">x</div>"#,
            r#"<div style="color:red;background:url(http://e.example/a);margin:0">x</div>"#,
            r#"<style>@IMPORT "http://e.example/a.css"; p{color:red}</style>"#,
            r#"<style>@import url(//e.example/a.css);</style>"#,
            r#"<style>@font-face{font-family:x;src:url(https://e.example/f.woff2)}</style>"#,
            r#"<style>p{background:url(https://e.example/a.png)} q{color:blue}</style>"#,
            r#"<style>@media screen{p{background:\000075rl(https://e.example/a.png)}}</style>"#,
        ];
        for c in cases {
            let r = render(c);
            assert_no_remote(&r.html, c);
            assert!(r.blocked_remote >= 1, "not counted: {c}\n{}", r.html);
        }
        let r = render(cases[9]);
        assert!(
            r.html.contains("color:red") && r.html.contains("margin:0"),
            "{}",
            r.html
        );
    }

    #[test]
    fn no_remote_references_corpus() {
        let hostile = [
            r#"<img src="https://e.example/p.gif">"#,
            r#"<img src='HTTP://e.example/p.gif'>"#,
            r#"<img src=//e.example/p.gif>"#,
            r#"<img src="  https://e.example/p.gif">"#,
            r#"<img src="relative/path.gif">"#,
            r#"<img srcset="https://e.example/a.png 1x, //e.example/b.png 2x">"#,
            r#"<img src="cid:x" srcset="https://e.example/a.png 1x">"#,
            r#"<picture><source srcset="https://e.example/a.webp"><img src="https://e.example/a.png"></picture>"#,
            r#"<table background="https://e.example/bg"><tr><td background="//e.example/bg">x</td></tr></table>"#,
            r#"<body background="https://e.example/bg">text</body>"#,
            r#"<video poster="https://e.example/p.png" src="https://e.example/v.mp4"><source src="https://e.example/v.mp4"></video>"#,
            r#"<audio src="https://e.example/a.mp3"></audio>"#,
            r#"<audio controls><source src="//e.example/a.mp3"></audio>"#,
            r#"<object data="https://e.example/o.swf"></object>"#,
            r#"<embed src="https://e.example/e.swf">"#,
            r#"<iframe src="https://e.example/"></iframe>"#,
            r#"<iframe srcdoc="<img src=https://e.example/x.png>"></iframe>"#,
            r#"<input type="image" src="https://e.example/i.png">"#,
            r#"<form action="https://e.example/post"><button formaction="https://e.example/b">go</button></form>"#,
            r#"<svg><image href="https://e.example/i.png"/><image xlink:href="//e.example/j.png"/></svg>"#,
            r#"<svg><use href="https://e.example/s.svg#a"/><use xlink:href="https://e.example/s.svg#a"/></svg>"#,
            r#"<link rel="preload" as="image" href="https://e.example/p.png">"#,
            r#"<link rel="stylesheet" href="//e.example/a.css">"#,
            r#"<meta http-equiv="refresh" content="0; url=https://e.example/">"#,
            r#"<base href="https://e.example/"><img src="p.gif">"#,
            r#"<div style="background:url(http://e.example/a.png)">x</div>"#,
            r#"<div style="BACKGROUND:URL( 'https://e.example/a.png' )">x</div>"#,
            r#"<div style="background:url(//e.example/a.png)">x</div>"#,
            r#"<div style="background:\75 rl(https://e.example/a.png)">x</div>"#,
            r#"<div style="background-image:image-set(url(https://e.example/a.png) 1x)">x</div>"#,
            r#"<div style="list-style:url(https://e.example/a.png)">x</div>"#,
            r#"<style>@import 'https://e.example/a.css';</style><p>x</p>"#,
            r#"<style>@font-face{font-family:f;src:url(//e.example/f.woff)}</style><p>x</p>"#,
            r#"<style>p{background:url("https://e.example/a.png")}</style>"#,
            r#"<style>/* c */ @import url( "https://e.example/a.css" ) screen;</style>"#,
            r#"<style></style><style>a{cursor:url(http://e.example/c.cur),auto}</style>"#,
            r#"<a href="https://e.example/click" ping="https://e.example/ping">x</a>"#,
            r#"<a href="//e.example/click">x</a>"#,
            r#"<p style="background:url(http://e.example/a.png)" onmouseover="x()">x</p>"#,
        ];
        assert!(hostile.len() >= 15);
        for h in hostile {
            let r = render(h);
            assert_no_remote(&r.html, h);
        }
    }

    #[test]
    fn style_close_tag_cannot_escape() {
        let r = render(r#"<style>p{content:"\3c /style\3e \3c script\3e alert(1)"}</style>"#);
        assert!(!r.html.to_lowercase().contains("<script"), "{}", r.html);
    }

    #[test]
    fn css_comment_markers_in_strings_cannot_hide_urls() {
        let cases = [
            r#"<style>p{content:"/*"; background:url(https://e.example/a.png); x:"*/"}</style>"#,
            r#"<style>p{content:"/*" url(https://e.example/a.png) "*/"}</style>"#,
            r#"<style>p{background:"/*",url(//e.example/a.png),"*/"}</style>"#,
            r#"<style>p{font-family:'/*';background-image:url('http://e.example/a.png');color:red;x:'*/'}</style>"#,
            r#"<div style="content:'/*';background:url(https://e.example/a.png);x:'*/'">x</div>"#,
            r#"<div style="content:&quot;/*&quot; url(//e.example/a.png) &quot;*/&quot;">x</div>"#,
            r#"<div style="background:url(&quot;https://e.example/a.png&quot;)">x</div>"#,
            r#"<div style="x:a&#59;background:url(https://e.example/a.png)">x</div>"#,
        ];
        for c in cases {
            let r = render(c);
            assert_no_remote(&r.html, c);
            assert!(r.blocked_remote >= 1, "not counted: {c}\n{}", r.html);
        }
    }

    #[test]
    fn style_attr_entities_roundtrip() {
        let r =
            render(r#"<p style="font-family:&quot;Open Sans&quot;,sans-serif;color:red">x</p>"#);
        assert!(
            r.html
                .contains(r#"style="font-family:&quot;Open Sans&quot;,sans-serif;color:red""#),
            "{}",
            r.html
        );
    }

    #[test]
    fn counting_rules() {
        let r = render(
            r#"<picture><source srcset="https://e.example/a.webp"><source srcset="https://e.example/b.webp"><img src="https://e.example/a.png"></picture>"#,
        );
        assert_eq!(r.blocked_remote, 1, "{}", r.html);
        let r = render(r#"<body background="https://e.example/bg.png"><p>x</p></body>"#);
        assert_eq!(r.blocked_remote, 1, "{}", r.html);
        assert_no_remote(&r.html, "body bg");
        let r = render(
            r#"<div style="background-image:image-set('https://e.example/a.png' 1x)">x</div>"#,
        );
        assert_eq!(r.blocked_remote, 1, "{}", r.html);
        // <picture> state does not leak to images after it.
        let r = render(
            r#"<picture><source srcset="https://e.example/a.webp"></picture><img src="https://e.example/b.png">"#,
        );
        assert_eq!(r.blocked_remote, 2, "{}", r.html);
    }

    /// Attributes (name, value) of every `<a>` in `out`, in order.
    fn anchors(out: &str) -> Vec<Vec<(String, String)>> {
        let found = RefCell::new(Vec::new());
        rewrite_str(
            out,
            RewriteStrSettings::new().append_element_content_handler(element!("a", |el| {
                let mut attrs: Vec<(String, String)> = el
                    .attributes()
                    .iter()
                    .map(|a| (a.name(), a.value()))
                    .collect();
                attrs.sort();
                found.borrow_mut().push(attrs);
                Ok(())
            })),
        )
        .unwrap();
        found.into_inner()
    }

    fn attr<'a>(a: &'a [(String, String)], name: &str) -> Option<&'a str> {
        a.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }

    #[test]
    fn link_title_is_the_real_href_not_the_senders() {
        let r = render(
            r#"<a href="https://real.example/x?a=1&b=2" title="https://bank.example/login">Your bank</a><a href="mailto:a@b.example">m</a><a title="https://bank.example/">no link</a>"#,
        );
        let a = anchors(&r.html);
        assert_eq!(a.len(), 3, "{}", r.html);
        for link in &a[..2] {
            assert!(attr(link, "href").is_some(), "{}", r.html);
            assert_eq!(attr(link, "title"), attr(link, "href"), "{}", r.html);
        }
        assert!(
            r.html
                .contains(r#"title="https://real.example/x?a=1&amp;b=2""#),
            "{}",
            r.html
        );
        // No link, nothing to show: the sender's claim is dropped too.
        assert_eq!(attr(&a[2], "title"), None);
        assert!(!r.html.contains("bank.example"), "{}", r.html);
    }

    #[test]
    fn link_title_cannot_break_out_of_its_attribute() {
        for html in [
            r#"<a href='https://x.example/"onmouseover="alert(1)'>x</a>"#,
            r#"<a href="https://x.example/&quot; onmouseover=&quot;alert(1)">x</a>"#,
            r#"<a href="https://x.example/'><script>alert(1)</script>">x</a>"#,
            r#"<a href="https://x.example/a&#34;b><img src=x onerror=alert(1)>" title='"><b>x</b>'>x</a>"#,
        ] {
            let r = render(html);
            assert_no_remote(&r.html, html);
            let a = anchors(&r.html);
            assert_eq!(a.len(), 1, "{html}: {}", r.html);
            let names: Vec<&str> = a[0].iter().map(|(n, _)| n.as_str()).collect();
            assert_eq!(
                names,
                ["href", "rel", "target", "title"],
                "{html}: {}",
                r.html
            );
            assert_eq!(attr(&a[0], "title"), attr(&a[0], "href"), "{html}");
            assert!(
                !r.html.contains("<script") && !r.html.contains("<img") && !r.html.contains("<b>"),
                "{html}: {}",
                r.html
            );
        }
    }

    #[test]
    fn plain_text_links_carry_their_url_as_title() {
        let raw = MsgBuilder::new()
            .text("go https://e.example/a?x=1&y=2 or https://e.example/it's\"onmouseover=x now")
            .build();
        let r = render_body(&raw, 1, &[]);
        let a = anchors(&r.html);
        assert_eq!(a.len(), 2, "{}", r.html);
        for link in &a {
            assert_eq!(attr(link, "title"), attr(link, "href"), "{}", r.html);
            let names: Vec<&str> = link.iter().map(|(n, _)| n.as_str()).collect();
            assert_eq!(names, ["href", "rel", "target", "title"], "{}", r.html);
        }
        assert!(
            r.html
                .contains(r#"title="https://e.example/a?x=1&amp;y=2""#),
            "{}",
            r.html
        );
        assert!(
            r.html.contains(r#"title="https://e.example/it&#39;s""#),
            "{}",
            r.html
        );
    }

    #[test]
    fn anchor_other_url_attrs_removed() {
        let r = render(
            r#"<a href="https://x.example/" ping="https://e.example/p" xlink:href="https://e.example/q">x</a>"#,
        );
        assert!(
            !r.html.contains("ping") && !r.html.contains("xlink"),
            "{}",
            r.html
        );
        assert!(r.html.contains(r#"href="https://x.example/""#));
    }
}
