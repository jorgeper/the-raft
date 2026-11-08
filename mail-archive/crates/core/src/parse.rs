//! RFC 822 parsing, Gmail headers and dedupe keys.

use mail_parser::{
    Addr, Address as MpAddress, HeaderValue, Message, MessageParser, MimeHeaders, PartType,
};
use sha2::{Digest, Sha256};

use crate::model::{Address, AttachmentInfo, DedupeKeys, Key, ParsedMessage, RawMessage};

const SNIPPET_MAX_BYTES: usize = 200;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ParseError {
    #[error("message is not parseable RFC 822")]
    Unparseable,
}

fn parse_raw(bytes: &[u8]) -> Option<Message<'_>> {
    MessageParser::default().parse(bytes)
}

fn convert_addr(a: &Addr<'_>) -> Option<Address> {
    let addr = a.address.as_deref()?.trim();
    if addr.is_empty() {
        return None;
    }
    let name = a
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string);
    Some(Address {
        name,
        addr: addr.to_string(),
    })
}

fn convert_addrs(a: Option<&MpAddress<'_>>) -> Vec<Address> {
    a.map(|a| a.iter().filter_map(convert_addr).collect())
        .unwrap_or_default()
}

fn text_list(v: &HeaderValue<'_>) -> Vec<String> {
    v.as_text_list()
        .map(|l| {
            l.iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn header_text(msg: &Message<'_>, name: &'static str) -> Option<String> {
    let v = msg.header(name)?;
    v.as_text().map(str::to_string)
}

fn truncate_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_message(raw: &RawMessage) -> Result<ParsedMessage, ParseError> {
    let msg = parse_raw(&raw.bytes).ok_or(ParseError::Unparseable)?;

    let thrid = header_text(&msg, "X-GM-THRID").and_then(|v| v.trim().parse::<u64>().ok());
    let labels = header_text(&msg, "X-Gmail-Labels")
        .map(|v| parse_gmail_labels(&v))
        .unwrap_or_default();

    let date = msg
        .date()
        .map(|d| d.to_timestamp())
        .or(raw.from_line_date)
        .unwrap_or(0);

    let body_text = body_text_of(&msg);
    let snippet = truncate_bytes(&collapse_whitespace(&body_text), SNIPPET_MAX_BYTES).to_string();

    let attachments = msg
        .attachments()
        .enumerate()
        .map(|(i, part)| AttachmentInfo {
            part_index: i as u32,
            filename: part.attachment_name().map(str::to_string),
            mime_type: part
                .content_type()
                .map(|ct| match ct.subtype() {
                    Some(sub) => format!("{}/{}", ct.ctype(), sub).to_ascii_lowercase(),
                    None => ct.ctype().to_ascii_lowercase(),
                })
                .unwrap_or_else(|| "application/octet-stream".into()),
            size: part.contents().len() as u64,
            content_id: part.content_id().map(|c| {
                c.trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string()
            }),
        })
        .collect();

    Ok(ParsedMessage {
        thrid,
        labels,
        message_id: msg.message_id().map(str::to_string),
        in_reply_to: text_list(msg.in_reply_to()).into_iter().next(),
        references: text_list(msg.references()),
        date,
        from: msg.from().and_then(|a| a.iter().find_map(convert_addr)),
        to: convert_addrs(msg.to()),
        cc: convert_addrs(msg.cc()),
        bcc: convert_addrs(msg.bcc()),
        subject: msg.subject().unwrap_or_default().to_string(),
        body_text,
        snippet,
        attachments,
        size: raw.bytes.len() as u64,
    })
}

/// Plain text of the message: text/plain parts if present, else HTML converted.
fn body_text_of(msg: &Message<'_>) -> String {
    let mut out = String::new();
    for part in msg.text_bodies() {
        let piece = match &part.body {
            PartType::Text(t) => t.to_string(),
            PartType::Html(h) => html_to_text(h),
            _ => continue,
        };
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(piece.trim());
    }
    out
}

/// Strip tags (and script/style content), decode entities, collapse whitespace.
fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        rest = &rest[lt..];
        if let Some(after) = rest.strip_prefix("<!--") {
            rest = after.find("-->").map_or("", |e| &after[e + 3..]);
            continue;
        }
        let Some(gt) = rest.find('>') else {
            // Unterminated tag: treat the remainder as markup.
            rest = "";
            break;
        };
        let tag = &rest[1..gt];
        rest = &rest[gt + 1..];
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        if !tag.starts_with('/') && (name == "script" || name == "style") {
            let close = format!("</{name}");
            rest = match find_ascii_ci(rest.as_bytes(), close.as_bytes()) {
                Some(i) => rest[i..].find('>').map_or("", |g| &rest[i + g + 1..]),
                None => "",
            };
        }
        // Block-level boundaries must not glue words together.
        out.push(' ');
    }
    out.push_str(rest);
    collapse_whitespace(&decode_entities(&out))
}

/// Case-insensitive (ASCII) substring search without allocating.
fn find_ascii_ci(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len())
        .position(|w| w.eq_ignore_ascii_case(needle))
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        // Entities are short: only look at a bounded window for the ';'.
        let window = &rest.as_bytes()[1..rest.len().min(12)];
        let decoded = window
            .iter()
            .position(|&b| b == b';')
            .and_then(|n| decode_entity(&rest[1..1 + n]).map(|c| (c, n + 2)));
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
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

fn decode_entity(name: &str) -> Option<char> {
    if let Some(num) = name.strip_prefix('#') {
        let code = match num.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => num.parse().ok()?,
        };
        return char::from_u32(code);
    }
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        "copy" => '\u{a9}',
        "reg" => '\u{ae}',
        "hellip" => '\u{2026}',
        "ndash" => '\u{2013}',
        "mdash" => '\u{2014}',
        "lsquo" => '\u{2018}',
        "rsquo" => '\u{2019}',
        "ldquo" => '\u{201c}',
        "rdquo" => '\u{201d}',
        "euro" => '\u{20ac}',
        _ => return None,
    })
}

/// Split an `X-Gmail-Labels` value on commas, honouring double quotes.
pub fn parse_gmail_labels(value: &str) -> Vec<String> {
    let mut labels = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                push_label(&mut labels, &cur);
                cur.clear();
            }
            _ => cur.push(c),
        }
    }
    push_label(&mut labels, &cur);
    labels
}

fn push_label(labels: &mut Vec<String>, raw: &str) {
    let l = raw.trim();
    if !l.is_empty() {
        labels.push(l.to_string());
    }
}

fn sha256(parts: &[&[u8]]) -> Key {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// `content_key`: SHA-256 of the bytes minus `X-Gmail-Labels` / `X-GM-THRID`
/// header lines (with folded continuations). `header_key`: SHA-256 of
/// `lower(message-id)\0date\0lower(from)`; `None` without a Message-ID.
pub fn dedupe_keys(raw: &RawMessage, parsed: &ParsedMessage) -> DedupeKeys {
    let header_key = parsed.message_id.as_deref().and_then(|id| {
        let id = id
            .trim()
            .trim_start_matches('<')
            .trim_end_matches('>')
            .to_lowercase();
        if id.is_empty() {
            return None;
        }
        let from = parsed
            .from
            .as_ref()
            .map(|a| a.addr.to_lowercase())
            .unwrap_or_default();
        Some(sha256(&[
            id.as_bytes(),
            b"\0",
            parsed.date.to_string().as_bytes(),
            b"\0",
            from.as_bytes(),
        ]))
    });
    DedupeKeys {
        content_key: sha256(&[&strip_gmail_headers(&raw.bytes)]),
        header_key,
    }
}

fn strip_gmail_headers(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut in_headers = true;
    let mut skipping = false;
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        if in_headers {
            if line == b"\n" || line == b"\r\n" {
                in_headers = false;
                skipping = false;
            } else if line[0] == b' ' || line[0] == b'\t' {
                if skipping {
                    continue;
                }
            } else {
                skipping = is_gmail_header(line);
                if skipping {
                    continue;
                }
            }
        }
        out.extend_from_slice(line);
    }
    out
}

fn is_gmail_header(line: &[u8]) -> bool {
    let Some(colon) = line.iter().position(|&b| b == b':') else {
        return false;
    };
    let name = &line[..colon];
    name.eq_ignore_ascii_case(b"X-Gmail-Labels") || name.eq_ignore_ascii_case(b"X-GM-THRID")
}

/// First real `text/html` body part, if any.
pub fn html_body(bytes: &[u8]) -> Option<String> {
    let msg = parse_raw(bytes)?;
    msg.html_bodies().find_map(|p| match &p.body {
        PartType::Html(h) => Some(h.to_string()),
        _ => None,
    })
}

/// First real `text/plain` body part, if any.
pub fn text_body(bytes: &[u8]) -> Option<String> {
    let msg = parse_raw(bytes)?;
    msg.text_bodies().find_map(|p| match &p.body {
        PartType::Text(t) => Some(t.to_string()),
        _ => None,
    })
}

/// Decoded content of the `part_index`-th attachment (as listed by `parse_message`).
pub fn attachment_bytes(bytes: &[u8], part_index: u32) -> Option<Vec<u8>> {
    let msg = parse_raw(bytes)?;
    msg.attachment(part_index).map(|p| p.contents().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Address;
    use crate::testing::MsgBuilder;

    fn raw(bytes: Vec<u8>) -> RawMessage {
        RawMessage {
            bytes,
            from_line_date: Some(1_000_000_000),
        }
    }

    fn parse(b: MsgBuilder) -> ParsedMessage {
        parse_message(&raw(b.build())).unwrap()
    }

    #[test]
    fn gmail_headers() {
        let p = parse(MsgBuilder::new().thrid(42).raw_header(
            "X-Gmail-Labels",
            "Inbox,Category Promotions,\"Receipts 2019\"",
        ));
        // MsgBuilder emits its own labels header only when labels are set,
        // so the raw header above is the only one.
        assert_eq!(p.thrid, Some(42));
        assert_eq!(p.labels, ["Inbox", "Category Promotions", "Receipts 2019"]);
    }

    #[test]
    fn gmail_headers_via_builder_and_folded() {
        let p = parse(MsgBuilder::new().labels(&["Inbox", "Work"]));
        assert_eq!(p.labels, ["Inbox", "Work"]);
        let folded = b"From: a@x.com\nX-Gmail-Labels: Inbox,\n \"Receipts 2019\",\n\tSent\nSubject: s\n\nbody\n".to_vec();
        let p = parse_message(&raw(folded)).unwrap();
        assert_eq!(p.labels, ["Inbox", "Receipts 2019", "Sent"]);
    }

    #[test]
    fn labels_with_quotes_and_unicode() {
        assert_eq!(
            parse_gmail_labels("\"a,b\",Família,Starred"),
            ["a,b", "Família", "Starred"]
        );
        assert!(parse_gmail_labels("").is_empty());
    }

    #[test]
    fn labels_header_with_raw_utf8_bytes() {
        let m = "From: a@x.com\nX-Gmail-Labels: \"a,b\",Família\nSubject: s\n\nb\n"
            .as_bytes()
            .to_vec();
        let p = parse_message(&raw(m)).unwrap();
        assert_eq!(p.labels, ["a,b", "Família"]);
    }

    #[test]
    fn addresses_and_subject() {
        let p = parse(
            MsgBuilder::new()
                .from("Ana Pérez <ana@x.com>")
                .to("bob@y.com, \"Cruz, Carl\" <carl@y.com>")
                .cc("dee@z.com")
                .subject("=?UTF-8?B?Q2Fmw6k=?= menu"),
        );
        assert_eq!(
            p.from,
            Some(Address {
                name: Some("Ana Pérez".into()),
                addr: "ana@x.com".into()
            })
        );
        assert_eq!(p.to.len(), 2);
        assert_eq!(p.to[0].addr, "bob@y.com");
        assert_eq!(p.to[1].name.as_deref(), Some("Cruz, Carl"));
        assert_eq!(p.cc[0].addr, "dee@z.com");
        assert_eq!(p.subject, "Café menu");
    }

    #[test]
    fn parses_date_and_ids() {
        let p = parse(
            MsgBuilder::new()
                .message_id(Some("<abc@x>"))
                .raw_header("In-Reply-To", "<p@x>")
                .raw_header("References", "<r1@x> <p@x>"),
        );
        assert_eq!(p.date, 1_793_563_756);
        assert_eq!(p.message_id.as_deref(), Some("abc@x"));
        assert_eq!(p.in_reply_to.as_deref(), Some("p@x"));
        assert_eq!(p.references, ["r1@x", "p@x"]);
    }

    #[test]
    fn date_falls_back_to_from_line() {
        let r = raw(MsgBuilder::new().no_date().build());
        assert_eq!(parse_message(&r).unwrap().date, r.from_line_date.unwrap());
        let r = raw(MsgBuilder::new().date_rfc2822("yesterday-ish").build());
        assert_eq!(parse_message(&r).unwrap().date, r.from_line_date.unwrap());
    }

    #[test]
    fn text_from_html_only() {
        let long = "word ".repeat(200);
        let p = parse(MsgBuilder::new().html(&format!(
            "<html><head><style>p{{color:red}}</style></head><body><p>Hello&nbsp;<b>World</b> &amp; co &#233;</p>\n\n<p>{long}</p></body></html>"
        )));
        assert!(
            p.body_text.starts_with("Hello World & co é"),
            "{:?}",
            p.body_text
        );
        assert!(!p.body_text.contains('<'));
        assert!(!p.body_text.contains("color"));
        assert!(p.snippet.starts_with("Hello World & co é"));
        assert!(p.snippet.len() <= 200);
        assert!(!p.snippet.is_empty());
    }

    #[test]
    fn html_to_text_is_linear_on_pathological_input() {
        let start = std::time::Instant::now();
        let amps = "a&b=".repeat(500_000);
        let t = html_to_text(&amps);
        assert!(t.starts_with("a&b=a&b="));
        let styles = "<STYLE>x</style>y ".repeat(50_000);
        assert!(html_to_text(&styles).starts_with("y y"));
        let unclosed = "<style>x".repeat(50_000);
        let _ = html_to_text(&unclosed);
        assert!(start.elapsed().as_secs() < 5, "{:?}", start.elapsed());
    }

    #[test]
    fn attachments_listed() {
        let pdf = b"%PDF-1.4 fake";
        let msg = MsgBuilder::new()
            .text("see attached")
            .html("<p>hi <img src=\"cid:logo\"></p>")
            .inline_image("logo", b"pngbytes")
            .attach("report.pdf", "application/pdf", pdf)
            .build();
        let p = parse_message(&raw(msg.clone())).unwrap();
        assert_eq!(p.attachments.len(), 2, "{:?}", p.attachments);
        let pdf_info = p
            .attachments
            .iter()
            .find(|a| a.filename.as_deref() == Some("report.pdf"))
            .unwrap();
        assert_eq!(pdf_info.mime_type, "application/pdf");
        assert_eq!(pdf_info.size, pdf.len() as u64);
        let img = p
            .attachments
            .iter()
            .find(|a| a.content_id.as_deref() == Some("logo"))
            .unwrap();
        assert_eq!(img.mime_type, "image/png");
        assert_eq!(
            attachment_bytes(&msg, pdf_info.part_index).as_deref(),
            Some(&pdf[..])
        );
        assert_eq!(
            attachment_bytes(&msg, img.part_index).as_deref(),
            Some(&b"pngbytes"[..])
        );
        assert_eq!(attachment_bytes(&msg, 99), None);
    }

    #[test]
    fn body_accessors() {
        let both = MsgBuilder::new()
            .text("plain one")
            .html("<p>html one</p>")
            .build();
        assert!(html_body(&both).unwrap().contains("html one"));
        assert_eq!(text_body(&both).unwrap().trim(), "plain one");
        let text_only = MsgBuilder::new().text("just text").build();
        assert_eq!(html_body(&text_only), None);
        let html_only = MsgBuilder::new().html("<p>only</p>").build();
        assert_eq!(text_body(&html_only), None);
    }

    #[test]
    fn charset_latin1() {
        let mut m = b"From: a@x.com\nSubject: s\nMIME-Version: 1.0\nContent-Type: text/plain; charset=ISO-8859-1\nContent-Transfer-Encoding: 8bit\n\ncora".to_vec();
        m.push(0xE7);
        m.extend_from_slice(b"\xE3o\n");
        let p = parse_message(&raw(m)).unwrap();
        assert!(p.body_text.contains("coraçã"), "{:?}", p.body_text);
    }

    #[test]
    fn parse_never_panics_on_garbage() {
        let mut state: u64 = 0x2545_F491_4F6C_DD1D;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let seeds: [&[u8]; 4] = [
            b"From: ",
            b"\nContent-Type: multipart/mixed; boundary=",
            b"=?utf-8?",
            b"\r\n\r\n",
        ];
        for _ in 0..1000 {
            let len = (next() % 512) as usize;
            let mut buf: Vec<u8> = (0..len).map(|_| next() as u8).collect();
            if next() % 2 == 0 {
                let s = seeds[(next() % 4) as usize];
                buf.splice(0..0, s.iter().copied());
            }
            let r = raw(buf);
            let parsed = parse_message(&r);
            if let Ok(p) = &parsed {
                let _ = dedupe_keys(&r, p);
            }
        }
    }

    fn key_of(bytes: Vec<u8>) -> DedupeKeys {
        let r = raw(bytes);
        let p = parse_message(&r).unwrap();
        dedupe_keys(&r, &p)
    }

    #[test]
    fn content_key_ignores_gmail_headers() {
        let base = || {
            MsgBuilder::new()
                .text("same body")
                .message_id(Some("<m@x>"))
        };
        let a = key_of(base().thrid(1).labels(&["Inbox"]).build());
        let b = key_of(base().thrid(2).labels(&["Sent", "Work"]).build());
        let plain = key_of(base().build());
        assert_eq!(a.content_key, b.content_key);
        assert_eq!(a.content_key, plain.content_key);
        let c = key_of(
            base()
                .text("different body")
                .thrid(1)
                .labels(&["Inbox"])
                .build(),
        );
        assert_ne!(a.content_key, c.content_key);
    }

    #[test]
    fn content_key_strips_folded_gmail_headers_only() {
        let a = b"From: a@x.com\nX-Gmail-Labels: Inbox,\n \"Receipts 2019\"\nX-GM-THRID: 5\nSubject: s\n\nbody\n".to_vec();
        let b = b"From: a@x.com\nx-gmail-labels: Sent\nSubject: s\n\nbody\n".to_vec();
        let c = b"From: a@x.com\nSubject: s\n\nbody\n".to_vec();
        let d = b"From: a@x.com\nSubject: s\n\nX-Gmail-Labels: body\n".to_vec();
        let ka = key_of(a).content_key;
        assert_eq!(ka, key_of(b).content_key);
        assert_eq!(ka, key_of(c).content_key);
        assert_ne!(ka, key_of(d).content_key);
    }

    #[test]
    fn header_key_none_without_message_id() {
        assert_eq!(key_of(MsgBuilder::new().text("x").build()).header_key, None);
    }

    #[test]
    fn header_key_normalizes() {
        let a = key_of(
            MsgBuilder::new()
                .message_id(Some("<ABC@x>"))
                .from("Al <Al@X.com>")
                .text("1")
                .build(),
        );
        let b = key_of(
            MsgBuilder::new()
                .message_id(Some("abc@x"))
                .from("al@x.com")
                .text("2")
                .build(),
        );
        assert!(a.header_key.is_some());
        assert_eq!(a.header_key, b.header_key);
        let c = key_of(
            MsgBuilder::new()
                .message_id(Some("abc@x"))
                .from("al@x.com")
                .date_rfc2822("Mon, 02 Nov 2026 20:09:16 +0000")
                .text("2")
                .build(),
        );
        assert_ne!(a.header_key, c.header_key);
    }
}
