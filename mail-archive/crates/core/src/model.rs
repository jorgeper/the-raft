use serde::{Deserialize, Serialize};

pub type MsgId = i64; // SQLite rowid
pub type Key = [u8; 32]; // SHA-256

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
