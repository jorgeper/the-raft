//! Synthetic fixture builders. Never put real mail here.

use std::io::Write;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

const DEFAULT_DATE: &str = "Sun, 01 Nov 2026 20:09:16 +0000";
const FROM_LINE: &str = "From 123@xxx Sun Nov 01 20:09:16 +0000 2026\n";

struct Part {
    headers: String,
    body: Vec<u8>,
}

impl Part {
    fn bytes(&self) -> Vec<u8> {
        let mut out = self.headers.clone().into_bytes();
        out.push(b'\n');
        out.extend_from_slice(&self.body);
        out
    }
}

fn multipart(subtype: &str, boundary: &str, parts: &[Part]) -> Part {
    let mut body = Vec::new();
    for p in parts {
        body.extend_from_slice(format!("--{boundary}\n").as_bytes());
        body.extend_from_slice(&p.bytes());
        if !body.ends_with(b"\n") {
            body.push(b'\n');
        }
    }
    body.extend_from_slice(format!("--{boundary}--\n").as_bytes());
    Part {
        headers: format!("Content-Type: multipart/{subtype}; boundary=\"{boundary}\"\n"),
        body,
    }
}

fn text_part(mime: &str, text: &str) -> Part {
    let mut body = text.as_bytes().to_vec();
    if !body.ends_with(b"\n") {
        body.push(b'\n');
    }
    Part {
        headers: format!(
            "Content-Type: {mime}; charset=utf-8\nContent-Transfer-Encoding: 8bit\n"
        ),
        body,
    }
}

fn base64_body(bytes: &[u8]) -> Vec<u8> {
    let encoded = STANDARD.encode(bytes);
    let mut out = Vec::new();
    for chunk in encoded.as_bytes().chunks(76) {
        out.extend_from_slice(chunk);
        out.push(b'\n');
    }
    out
}

/// Chainable builder for RFC 822 test messages (LF line endings).
pub struct MsgBuilder {
    from: String,
    to: Option<String>,
    cc: Option<String>,
    subject: String,
    date: Option<String>,
    message_id: Option<String>,
    thrid: Option<u64>,
    labels: Vec<String>,
    text: Option<String>,
    html: Option<String>,
    attachments: Vec<(String, String, Vec<u8>)>,
    inline_images: Vec<(String, Vec<u8>)>,
    raw_headers: Vec<(String, String)>,
}

impl Default for MsgBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl MsgBuilder {
    pub fn new() -> Self {
        Self {
            from: "alice@example.com".into(),
            to: None,
            cc: None,
            subject: String::new(),
            date: Some(DEFAULT_DATE.into()),
            message_id: None,
            thrid: None,
            labels: Vec::new(),
            text: None,
            html: None,
            attachments: Vec::new(),
            inline_images: Vec::new(),
            raw_headers: Vec::new(),
        }
    }

    pub fn from(mut self, v: &str) -> Self {
        self.from = v.into();
        self
    }

    pub fn to(mut self, v: &str) -> Self {
        self.to = Some(v.into());
        self
    }

    pub fn cc(mut self, v: &str) -> Self {
        self.cc = Some(v.into());
        self
    }

    pub fn subject(mut self, v: &str) -> Self {
        self.subject = v.into();
        self
    }

    pub fn date_rfc2822(mut self, v: &str) -> Self {
        self.date = Some(v.into());
        self
    }

    pub fn no_date(mut self) -> Self {
        self.date = None;
        self
    }

    pub fn message_id(mut self, v: Option<&str>) -> Self {
        self.message_id = v.map(Into::into);
        self
    }

    pub fn thrid(mut self, v: u64) -> Self {
        self.thrid = Some(v);
        self
    }

    pub fn labels(mut self, v: &[&str]) -> Self {
        self.labels = v.iter().map(|s| s.to_string()).collect();
        self
    }

    pub fn text(mut self, v: &str) -> Self {
        self.text = Some(v.into());
        self
    }

    pub fn html(mut self, v: &str) -> Self {
        self.html = Some(v.into());
        self
    }

    pub fn attach(mut self, name: &str, mime: &str, bytes: &[u8]) -> Self {
        self.attachments
            .push((name.into(), mime.into(), bytes.to_vec()));
        self
    }

    pub fn inline_image(mut self, cid: &str, bytes: &[u8]) -> Self {
        self.inline_images.push((cid.into(), bytes.to_vec()));
        self
    }

    pub fn raw_header(mut self, name: &str, value: &str) -> Self {
        self.raw_headers.push((name.into(), value.into()));
        self
    }

    /// RFC 822 bytes; always ends with a newline.
    pub fn build(&self) -> Vec<u8> {
        let mut head = format!("From: {}\n", self.from);
        if let Some(v) = &self.to {
            head += &format!("To: {v}\n");
        }
        if let Some(v) = &self.cc {
            head += &format!("Cc: {v}\n");
        }
        head += &format!("Subject: {}\n", self.subject);
        if let Some(v) = &self.date {
            head += &format!("Date: {v}\n");
        }
        if let Some(v) = &self.message_id {
            head += &format!("Message-ID: {v}\n");
        }
        if let Some(v) = self.thrid {
            head += &format!("X-GM-THRID: {v}\n");
        }
        if !self.labels.is_empty() {
            head += &format!("X-Gmail-Labels: {}\n", self.labels.join(","));
        }
        for (n, v) in &self.raw_headers {
            head += &format!("{n}: {v}\n");
        }
        head += "MIME-Version: 1.0\n";

        let part = self.body_part();
        let mut out = head.into_bytes();
        out.extend_from_slice(&part.bytes());
        out
    }

    fn body_part(&self) -> Part {
        let html_part = self.html.as_ref().map(|h| {
            let html = text_part("text/html", h);
            if self.inline_images.is_empty() {
                return html;
            }
            let mut parts = vec![html];
            for (cid, bytes) in &self.inline_images {
                parts.push(Part {
                    headers: format!(
                        "Content-Type: image/png\nContent-Transfer-Encoding: base64\n\
                         Content-ID: <{cid}>\nContent-Disposition: inline\n"
                    ),
                    body: base64_body(bytes),
                });
            }
            multipart("related", "=_rel", &parts)
        });
        let text_part = self.text.as_ref().map(|t| text_part("text/plain", t));

        let body = match (text_part, html_part) {
            (Some(t), Some(h)) => multipart("alternative", "=_alt", &[t, h]),
            (Some(p), None) | (None, Some(p)) => p,
            (None, None) => text_part_empty(),
        };
        if self.attachments.is_empty() {
            return body;
        }
        let mut parts = vec![body];
        for (name, mime, bytes) in &self.attachments {
            parts.push(Part {
                headers: format!(
                    "Content-Type: {mime}; name=\"{name}\"\nContent-Transfer-Encoding: base64\n\
                     Content-Disposition: attachment; filename=\"{name}\"\n"
                ),
                body: base64_body(bytes),
            });
        }
        multipart("mixed", "=_mix", &parts)
    }
}

fn text_part_empty() -> Part {
    text_part("text/plain", "")
}

/// Concatenate messages into an mboxrd file. Each message gets a `From_` line,
/// has `^>*From ` body lines escaped, and is followed by one blank line.
pub fn mbox_of(msgs: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    for msg in msgs {
        out.extend_from_slice(FROM_LINE.as_bytes());
        for line in msg.split_inclusive(|&b| b == b'\n') {
            let gt = line.iter().take_while(|&&b| b == b'>').count();
            if line[gt..].starts_with(b"From ") {
                out.push(b'>');
            }
            out.extend_from_slice(line);
        }
        if !msg.ends_with(b"\n") {
            out.push(b'\n');
        }
        out.push(b'\n');
    }
    out
}

/// A zip archive containing a single stored entry.
pub fn zip_of(entry_name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zw.start_file(entry_name, zip::write::SimpleFileOptions::default())
        .expect("start zip entry");
    zw.write_all(bytes).expect("write zip entry");
    zw.finish().expect("finish zip").into_inner()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_multipart_with_all_features() {
        let msg = MsgBuilder::new()
            .to("bob@example.com")
            .thrid(42)
            .labels(&["Inbox", "Work"])
            .text("plain")
            .html("<p>rich</p><img src=\"cid:logo\">")
            .inline_image("logo", b"png")
            .attach("a.txt", "text/plain", b"hello")
            .build();
        let s = String::from_utf8(msg).unwrap();
        assert!(s.ends_with('\n'));
        for needle in [
            "X-GM-THRID: 42\n",
            "X-Gmail-Labels: Inbox,Work\n",
            "multipart/mixed",
            "multipart/alternative",
            "multipart/related",
            "Content-ID: <logo>",
            "filename=\"a.txt\"",
        ] {
            assert!(s.contains(needle), "missing {needle}");
        }
    }

    #[test]
    fn no_date_omits_header() {
        let s = String::from_utf8(MsgBuilder::new().no_date().build()).unwrap();
        assert!(!s.contains("Date:"));
    }

    #[test]
    fn zip_has_signature() {
        assert!(zip_of("a.mbox", b"x").starts_with(b"PK"));
    }
}
