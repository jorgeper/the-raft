use serde::{Deserialize, Serialize};

pub type MsgId = i64; // SQLite rowid
pub type Key = [u8; 32]; // SHA-256

/// Parse a thread id sent by the UI: an optional `-` and decimal digits.
pub fn parse_thread_id(s: &str) -> Option<i64> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Serde helpers that send a thread id across IPC as a decimal string.
/// Gmail thread ids (~1.9e18) are past 2^53, so a JavaScript number cannot
/// hold them exactly. Inside Rust they stay `i64`.
pub mod thread_id_string {
    use serde::{Deserialize, Deserializer, Serializer, de::Error as _};

    pub fn serialize<S: Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(v)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        let s = String::deserialize(d)?;
        super::parse_thread_id(&s).ok_or_else(|| D::Error::custom("bad thread id"))
    }
}

/// One message from an mbox: `From_` line stripped, mboxrd-unescaped.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct RawMessage {
    pub bytes: Vec<u8>,
    pub from_line_date: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Address {
    pub name: Option<String>,
    pub addr: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct AttachmentInfo {
    pub part_index: u32,
    pub filename: Option<String>,
    pub mime_type: String,
    pub size: u64,
    pub content_id: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct ParsedMessage {
    pub thrid: Option<u64>,
    pub labels: Vec<String>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    /// Unix seconds, UTC.
    pub date: i64,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub body_text: String,
    /// At most 200 chars.
    pub snippet: String,
    pub attachments: Vec<AttachmentInfo>,
    pub size: u64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct DedupeKeys {
    pub content_key: Key,
    pub header_key: Option<Key>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct MessageRef {
    pub pack_id: u32,
    pub offset: u64,
    pub length: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub enum ImportKind {
    Full,
    Partial,
}
