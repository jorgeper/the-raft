//! SQLite metadata cache (`meta.sqlite`, WAL). Rebuildable from the message
//! store plus the event log; never the source of truth.
//!
//! Batching: [`MetaDb::transaction`] wraps a closure in `BEGIN IMMEDIATE` /
//! `COMMIT` (rollback on `Err`). The closure typically captures `&self` and
//! calls `insert_message` repeatedly; nested calls join the outer transaction.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use crate::model::{
    Address, AttachmentInfo, DedupeKeys, ImportKind, Key, MessageRef, MsgId, ParsedMessage,
};
use crate::{Error, Result, paths};

pub const SCHEMA_VERSION: i64 = 1;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS messages(
    id INTEGER PRIMARY KEY,
    content_key BLOB NOT NULL UNIQUE,
    header_key BLOB,
    message_id TEXT,
    thrid INTEGER NOT NULL DEFAULT 0,
    date INTEGER NOT NULL,
    from_name TEXT,
    from_addr TEXT,
    to_json TEXT NOT NULL,
    cc_json TEXT NOT NULL,
    bcc_json TEXT NOT NULL,
    subject TEXT NOT NULL,
    snippet TEXT NOT NULL,
    size INTEGER NOT NULL,
    has_attachments INTEGER NOT NULL,
    pack_id INTEGER NOT NULL,
    offset INTEGER NOT NULL,
    length INTEGER NOT NULL,
    first_seen_import INTEGER NOT NULL,
    last_seen_import INTEGER NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_header_key ON messages(header_key) WHERE header_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_message_id ON messages(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thrid, date);
CREATE INDEX IF NOT EXISTS messages_first_seen ON messages(first_seen_import);
CREATE INDEX IF NOT EXISTS messages_date ON messages(date);
CREATE TABLE IF NOT EXISTS labels(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS message_labels(
    message_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    PRIMARY KEY(message_id, label_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS message_labels_label ON message_labels(label_id);
CREATE TABLE IF NOT EXISTS attachments(
    message_id INTEGER NOT NULL,
    part_index INTEGER NOT NULL,
    filename TEXT,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_id TEXT,
    PRIMARY KEY(message_id, part_index)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS addresses(
    addr TEXT PRIMARY KEY,
    name TEXT,
    search TEXT NOT NULL,
    count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS imports(
    id INTEGER PRIMARY KEY,
    started_at INTEGER,
    source TEXT,
    kind TEXT,
    status TEXT,
    summary_json TEXT
);
CREATE INDEX IF NOT EXISTS imports_status ON imports(status);
";

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
pub enum ImportStatus {
    Running,
    Finalizing,
    Completed,
}

impl ImportStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Finalizing => "finalizing",
            Self::Completed => "completed",
        }
    }
    fn parse(s: &str) -> Result<Self> {
        match s {
            "running" => Ok(Self::Running),
            "finalizing" => Ok(Self::Finalizing),
            "completed" => Ok(Self::Completed),
            o => Err(Error::Meta(format!("bad import status {o:?}"))),
        }
    }
}

fn kind_str(k: ImportKind) -> &'static str {
    match k {
        ImportKind::Full => "Full",
        ImportKind::Partial => "Partial",
    }
}

fn parse_kind(s: &str) -> Result<ImportKind> {
    match s {
        "Full" => Ok(ImportKind::Full),
        "Partial" => Ok(ImportKind::Partial),
        o => Err(Error::Meta(format!("bad import kind {o:?}"))),
    }
}

/// In-memory dedupe lookup tables for the importer's scan phase.
#[derive(Default, Debug)]
pub struct KeyIndex {
    pub by_content: HashMap<Key, MsgId>,
    /// header key -> (message id, Gmail thread id if the message has one).
    pub by_header: HashMap<Key, Vec<(MsgId, Option<u64>)>>,
    pub labels: HashMap<MsgId, Vec<String>>,
}

/// The few columns needed to summarize a thread in a result list.
#[derive(Clone, PartialEq, Debug)]
pub struct MsgSummary {
    pub id: MsgId,
    pub date: i64,
    pub from_name: Option<String>,
    pub from_addr: Option<String>,
    pub subject: String,
    pub snippet: String,
    pub has_attachments: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct MessageRow {
    pub id: MsgId,
    #[serde(skip)]
    pub content_key: Key,
    #[serde(skip)]
    pub header_key: Option<Key>,
    pub message_id: Option<String>,
    /// Thread id as stored: Gmail `thrid as i64`, or negative if synthetic.
    /// A decimal string in JSON (see [`crate::model::thread_id_string`]).
    #[serde(with = "crate::model::thread_id_string")]
    pub thrid: i64,
    pub date: i64,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub snippet: String,
    pub size: u64,
    pub has_attachments: bool,
    pub msg_ref: MessageRef,
    pub first_seen_import: u64,
    pub last_seen_import: u64,
    pub labels: Vec<String>,
    pub attachments: Vec<AttachmentInfo>,
    pub removed: bool,
}

struct TxGuard<'a> {
    conn: &'a Connection,
    done: bool,
}

impl Drop for TxGuard<'_> {
    fn drop(&mut self) {
        if !self.done && !self.conn.is_autocommit() {
            let _ = self.conn.execute_batch("ROLLBACK");
        }
    }
}

pub struct MetaDb {
    conn: Connection,
}

fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(|e| Error::Meta(e.to_string()))
}

fn unjson(s: &str) -> Result<Vec<Address>> {
    serde_json::from_str(s).map_err(|e| Error::Meta(e.to_string()))
}

fn key_from(v: Vec<u8>) -> Result<Key> {
    v.try_into()
        .map_err(|_| Error::Meta("stored key is not 32 bytes".into()))
}

/// Escape `%`, `_` and `\` for use in `LIKE ... ESCAPE '\'`.
fn like_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            o.push('\\');
        }
        o.push(c);
    }
    o
}

/// Lowercase and strip diacritics (NFD, drop combining marks).
fn fold(s: &str) -> String {
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

/// Folded address followed by each folded alphanumeric word of the display
/// name, space-separated and space-prefixed: `" addr word word"`.
fn search_key(addr: &str, name: Option<&str>) -> String {
    let mut k = format!(" {}", fold(addr));
    if let Some(n) = name {
        for w in fold(n)
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
        {
            k.push(' ');
            k.push_str(w);
        }
    }
    k
}

const ROW_COLS: &str = "id, content_key, header_key, message_id, thrid, date, from_name, from_addr, \
    to_json, cc_json, bcc_json, subject, snippet, size, has_attachments, pack_id, offset, length, \
    first_seen_import, last_seen_import, removed";

impl MetaDb {
    /// An empty in-memory database without schema, standing in for a closed
    /// one while the real file is swapped.
    pub(crate) fn placeholder() -> Result<MetaDb> {
        Ok(MetaDb {
            conn: Connection::open_in_memory()?,
        })
    }

    pub fn open(path: &Path) -> Result<MetaDb> {
        if !path.exists() {
            paths::create_private_file(path)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // Make syncs (only done at checkpoints under WAL + NORMAL) real
        // barriers on macOS.
        conn.pragma_update(None, "fullfsync", "ON")?;
        conn.pragma_update(None, "checkpoint_fullfsync", "ON")?;
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if v > SCHEMA_VERSION {
            return Err(Error::Meta(format!(
                "schema version {v} is newer than supported"
            )));
        }
        conn.execute_batch(SCHEMA)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(MetaDb { conn })
    }

    /// Run `f` in one transaction; commits on `Ok`, rolls back on `Err`.
    /// If a transaction is already open, `f` simply joins it.
    pub fn transaction<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        if !self.conn.is_autocommit() {
            return f();
        }
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        // Rolls back on early return (Err, failed COMMIT) and on panic.
        let mut guard = TxGuard {
            conn: &self.conn,
            done: false,
        };
        let v = f()?;
        self.conn.execute_batch("COMMIT")?;
        guard.done = true;
        Ok(v)
    }

    pub fn insert_message(
        &self,
        p: &ParsedMessage,
        k: &DedupeKeys,
        r: MessageRef,
        import_id: u64,
    ) -> Result<MsgId> {
        self.transaction(|| self.insert_message_inner(p, k, r, import_id))
    }

    fn insert_message_inner(
        &self,
        p: &ParsedMessage,
        k: &DedupeKeys,
        r: MessageRef,
        import_id: u64,
    ) -> Result<MsgId> {
        let resolved = match p.thrid {
            Some(t) => Some(t as i64),
            None => self.thread_from_root(p)?,
        };
        let thrid = resolved.unwrap_or(0);
        let mut ins = self.conn.prepare_cached(
            "INSERT INTO messages(content_key, header_key, message_id, thrid, date, from_name, \
             from_addr, to_json, cc_json, bcc_json, subject, snippet, size, has_attachments, \
             pack_id, offset, length, first_seen_import, last_seen_import) \
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )?;
        ins.execute(params![
            &k.content_key[..],
            k.header_key.as_ref().map(|h| &h[..]),
            p.message_id,
            thrid,
            p.date,
            p.from.as_ref().and_then(|a| a.name.as_deref()),
            p.from.as_ref().map(|a| a.addr.as_str()),
            json(&p.to)?,
            json(&p.cc)?,
            json(&p.bcc)?,
            p.subject,
            p.snippet,
            p.size as i64,
            !p.attachments.is_empty(),
            r.pack_id,
            r.offset as i64,
            r.length,
            import_id as i64,
            import_id as i64,
        ])?;
        let id = self.conn.last_insert_rowid();
        if resolved.is_none() {
            self.conn
                .prepare_cached("UPDATE messages SET thrid = ? WHERE id = ?")?
                .execute(params![-id, id])?;
        }
        if !p.attachments.is_empty() {
            let mut a = self.conn.prepare_cached(
                "INSERT INTO attachments(message_id, part_index, filename, mime_type, size, content_id) \
                 VALUES(?,?,?,?,?,?)",
            )?;
            for x in &p.attachments {
                a.execute(params![
                    id,
                    x.part_index,
                    x.filename,
                    x.mime_type,
                    x.size as i64,
                    x.content_id
                ])?;
            }
        }
        self.write_labels(id, &p.labels)?;
        self.bump_addresses(p.from.iter().chain(&p.to).chain(&p.cc).chain(&p.bcc))?;
        Ok(id)
    }

    /// Thread id of the root (first `References` entry, else `In-Reply-To`),
    /// if that message is already stored.
    fn thread_from_root(&self, p: &ParsedMessage) -> Result<Option<i64>> {
        let Some(root) = p.references.first().or(p.in_reply_to.as_ref()) else {
            return Ok(None);
        };
        Ok(self
            .conn
            .prepare_cached("SELECT thrid FROM messages WHERE message_id = ? ORDER BY id LIMIT 1")?
            .query_row([root], |r| r.get(0))
            .optional()?)
    }

    fn bump_addresses<'a>(&self, it: impl Iterator<Item = &'a Address>) -> Result<()> {
        let mut up = self.conn.prepare_cached(
            "INSERT INTO addresses(addr, name, search, count) VALUES(?1, ?2, ?3, 1) \
             ON CONFLICT(addr) DO UPDATE SET count = count + 1, \
               name = coalesce(name, ?2), \
               search = CASE WHEN name IS NULL AND ?2 IS NOT NULL THEN ?3 ELSE search END",
        )?;
        for a in it {
            let name = a.name.as_deref().filter(|n| !n.is_empty());
            up.execute(params![a.addr, name, search_key(&a.addr, name)])?;
        }
        Ok(())
    }

    fn write_labels(&self, id: MsgId, labels: &[String]) -> Result<()> {
        self.conn
            .prepare_cached("DELETE FROM message_labels WHERE message_id = ?")?
            .execute([id])?;
        let mut ins_label = self
            .conn
            .prepare_cached("INSERT OR IGNORE INTO labels(name) VALUES(?)")?;
        let mut link = self.conn.prepare_cached(
            "INSERT OR IGNORE INTO message_labels(message_id, label_id) \
             SELECT ?, id FROM labels WHERE name = ?",
        )?;
        for l in labels {
            ins_label.execute([l])?;
            link.execute(params![id, l])?;
        }
        Ok(())
    }

    /// Replace the label set of a message.
    pub fn set_labels(&self, id: MsgId, labels: &[String]) -> Result<()> {
        self.transaction(|| self.write_labels(id, labels))
    }

    /// For every row set `removed = (id IN absent)`; rows not in `absent` get
    /// `last_seen_import = import_id`.
    pub fn mark_seen(&self, import_id: u64, absent: &[MsgId]) -> Result<()> {
        self.transaction(|| {
            self.conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS absent(id INTEGER PRIMARY KEY); DELETE FROM absent;",
            )?;
            {
                let mut ins = self
                    .conn
                    .prepare_cached("INSERT OR IGNORE INTO temp.absent(id) VALUES(?)")?;
                for id in absent {
                    ins.execute([id])?;
                }
            }
            self.conn.execute(
                "UPDATE messages SET \
                   removed = (id IN (SELECT id FROM temp.absent)), \
                   last_seen_import = CASE WHEN id IN (SELECT id FROM temp.absent) \
                                           THEN last_seen_import ELSE ?1 END",
                [import_id as i64],
            )?;
            self.conn.execute_batch("DELETE FROM absent")?;
            Ok(())
        })
    }

    pub fn key_index(&self) -> Result<KeyIndex> {
        let mut ki = KeyIndex::default();
        let mut st = self
            .conn
            .prepare("SELECT id, content_key, header_key, thrid FROM messages")?;
        let mut rows = st.query([])?;
        while let Some(r) = rows.next()? {
            let id: MsgId = r.get(0)?;
            ki.by_content.insert(key_from(r.get(1)?)?, id);
            if let Some(h) = r.get::<_, Option<Vec<u8>>>(2)? {
                let thrid: i64 = r.get(3)?;
                ki.by_header
                    .entry(key_from(h)?)
                    .or_default()
                    .push((id, (thrid >= 0).then_some(thrid as u64)));
            }
        }
        let mut st = self.conn.prepare(
            "SELECT ml.message_id, l.name FROM message_labels ml JOIN labels l ON l.id = ml.label_id",
        )?;
        let mut rows = st.query([])?;
        while let Some(r) = rows.next()? {
            ki.labels.entry(r.get(0)?).or_default().push(r.get(1)?);
        }
        for v in ki.labels.values_mut() {
            v.sort();
        }
        Ok(ki)
    }

    fn row_from(&self, r: &rusqlite::Row<'_>) -> Result<MessageRow> {
        let id: MsgId = r.get(0)?;
        let from_addr: Option<String> = r.get(7)?;
        let mut row = MessageRow {
            id,
            content_key: key_from(r.get(1)?)?,
            header_key: r.get::<_, Option<Vec<u8>>>(2)?.map(key_from).transpose()?,
            message_id: r.get(3)?,
            thrid: r.get(4)?,
            date: r.get(5)?,
            from: None,
            to: unjson(&r.get::<_, String>(8)?)?,
            cc: unjson(&r.get::<_, String>(9)?)?,
            bcc: unjson(&r.get::<_, String>(10)?)?,
            subject: r.get(11)?,
            snippet: r.get(12)?,
            size: r.get::<_, i64>(13)? as u64,
            has_attachments: r.get(14)?,
            msg_ref: MessageRef {
                pack_id: r.get(15)?,
                offset: r.get::<_, i64>(16)? as u64,
                length: r.get(17)?,
            },
            first_seen_import: r.get::<_, i64>(18)? as u64,
            last_seen_import: r.get::<_, i64>(19)? as u64,
            removed: r.get(20)?,
            labels: Vec::new(),
            attachments: Vec::new(),
        };
        if let Some(addr) = from_addr {
            row.from = Some(Address {
                name: r.get(6)?,
                addr,
            });
        }
        row.labels = self
            .conn
            .prepare_cached(
                "SELECT l.name FROM message_labels ml JOIN labels l ON l.id = ml.label_id \
                 WHERE ml.message_id = ? ORDER BY l.name",
            )?
            .query_map([id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        row.attachments = self
            .conn
            .prepare_cached(
                "SELECT part_index, filename, mime_type, size, content_id FROM attachments \
                 WHERE message_id = ? ORDER BY part_index",
            )?
            .query_map([id], |r| {
                Ok(AttachmentInfo {
                    part_index: r.get(0)?,
                    filename: r.get(1)?,
                    mime_type: r.get(2)?,
                    size: r.get::<_, i64>(3)? as u64,
                    content_id: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(row)
    }

    fn rows(&self, sql: &str, arg: i64) -> Result<Vec<MessageRow>> {
        let mut st = self.conn.prepare_cached(sql)?;
        let mut rows = st.query([arg])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(self.row_from(r)?);
        }
        Ok(out)
    }

    pub fn message(&self, id: MsgId) -> Result<MessageRow> {
        let sql = format!("SELECT {ROW_COLS} FROM messages WHERE id = ?");
        self.rows(&sql, id)?
            .pop()
            .ok_or_else(|| Error::Meta(format!("no message {id}")))
    }

    /// All messages of a thread, oldest first.
    pub fn thread(&self, thrid: i64) -> Result<Vec<MessageRow>> {
        let sql = format!("SELECT {ROW_COLS} FROM messages WHERE thrid = ? ORDER BY date, id");
        self.rows(&sql, thrid)
    }

    /// Light per-message summaries for a set of threads in one query, grouped
    /// by thread id, each list oldest first.
    pub fn thread_summaries(&self, thrids: &[i64]) -> Result<HashMap<i64, Vec<MsgSummary>>> {
        let mut out: HashMap<i64, Vec<MsgSummary>> = HashMap::new();
        // Stay well under SQLite's bound-parameter limit.
        for chunk in thrids.chunks(500) {
            let marks = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT thrid, id, date, from_name, from_addr, subject, snippet, has_attachments \
                 FROM messages WHERE thrid IN ({marks}) ORDER BY date, id"
            );
            let mut st = self.conn.prepare(&sql)?;
            let mut rows = st.query(rusqlite::params_from_iter(chunk))?;
            while let Some(r) = rows.next()? {
                out.entry(r.get(0)?).or_default().push(MsgSummary {
                    id: r.get(1)?,
                    date: r.get(2)?,
                    from_name: r.get(3)?,
                    from_addr: r.get(4)?,
                    subject: r.get(5)?,
                    snippet: r.get(6)?,
                    has_attachments: r.get(7)?,
                });
            }
        }
        Ok(out)
    }

    /// Labels whose name starts with `prefix` (case-insensitive), most used first.
    pub fn top_labels(&self, prefix: &str, limit: usize) -> Result<Vec<String>> {
        let pat = format!("{}%", like_escape(&prefix.to_lowercase()));
        let mut st = self.conn.prepare_cached(
            "SELECT l.name FROM labels l JOIN message_labels ml ON ml.label_id = l.id \
             WHERE lower(l.name) LIKE ?1 ESCAPE '\\' \
             GROUP BY l.id ORDER BY count(*) DESC, l.name LIMIT ?2",
        )?;
        let v = st
            .query_map(params![pat, limit as i64], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(v)
    }

    /// Addresses where `prefix` matches the start of the address or of any
    /// alphanumeric word of the display name, ignoring case and diacritics,
    /// most frequent first.
    pub fn top_addresses(&self, prefix: &str, limit: usize) -> Result<Vec<Address>> {
        let p = like_escape(&fold(prefix));
        let mut st = self.conn.prepare_cached(
            "SELECT addr, name FROM addresses WHERE search LIKE ?1 ESCAPE '\\' \
             ORDER BY count DESC, addr LIMIT ?2",
        )?;
        let v = st
            .query_map(params![format!("% {p}%"), limit as i64], |r| {
                Ok(Address {
                    addr: r.get(0)?,
                    name: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(v)
    }

    /// Delete messages first seen in `import_id`, their label/attachment/address
    /// contributions, and the import row itself.
    pub fn delete_import(&self, import_id: u64) -> Result<()> {
        self.transaction(|| {
            let id = import_id as i64;
            // Aggregate address occurrences of the doomed rows, then decrement.
            let mut dec: HashMap<String, i64> = HashMap::new();
            {
                let mut st = self.conn.prepare_cached(
                    "SELECT from_addr, to_json, cc_json, bcc_json FROM messages \
                     WHERE first_seen_import = ?",
                )?;
                let mut rows = st.query([id])?;
                while let Some(r) = rows.next()? {
                    if let Some(a) = r.get::<_, Option<String>>(0)? {
                        *dec.entry(a).or_default() += 1;
                    }
                    for i in 1..=3 {
                        for a in unjson(&r.get::<_, String>(i)?)? {
                            *dec.entry(a.addr).or_default() += 1;
                        }
                    }
                }
            }
            {
                let mut up = self
                    .conn
                    .prepare_cached("UPDATE addresses SET count = count - ? WHERE addr = ?")?;
                for (a, n) in &dec {
                    up.execute(params![n, a])?;
                }
            }
            self.conn
                .execute("DELETE FROM addresses WHERE count <= 0", [])?;
            for t in ["message_labels", "attachments"] {
                self.conn.execute(
                    &format!(
                        "DELETE FROM {t} WHERE message_id IN \
                         (SELECT id FROM messages WHERE first_seen_import = ?)"
                    ),
                    [id],
                )?;
            }
            self.conn
                .execute("DELETE FROM messages WHERE first_seen_import = ?", [id])?;
            self.conn.execute(
                "DELETE FROM labels WHERE id NOT IN (SELECT label_id FROM message_labels)",
                [],
            )?;
            self.conn
                .execute("DELETE FROM imports WHERE id = ?", [id])?;
            Ok(())
        })
    }

    /// Stored thread id of a message (Gmail's, or the synthetic fallback).
    pub fn thrid_of(&self, id: MsgId) -> Result<i64> {
        Ok(self
            .conn
            .prepare_cached("SELECT thrid FROM messages WHERE id = ?")?
            .query_row([id], |r| r.get(0))?)
    }

    pub fn content_key(&self, id: MsgId) -> Result<Key> {
        let k: Vec<u8> = self
            .conn
            .prepare_cached("SELECT content_key FROM messages WHERE id = ?")?
            .query_row([id], |r| r.get(0))?;
        key_from(k)
    }

    /// Ids of all messages flagged removed, ascending.
    pub fn removed_ids(&self) -> Result<Vec<MsgId>> {
        let mut st = self
            .conn
            .prepare_cached("SELECT id FROM messages WHERE removed ORDER BY id")?;
        let v = st
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(v)
    }

    /// Make every committed transaction durable (WAL with `synchronous =
    /// NORMAL` only syncs at checkpoints).
    pub fn checkpoint(&self) -> Result<()> {
        let busy: i64 = self
            .conn
            .query_row("PRAGMA wal_checkpoint(FULL)", [], |r| r.get(0))?;
        if busy != 0 {
            return Err(Error::Meta("WAL checkpoint could not complete".into()));
        }
        Ok(())
    }

    /// Checkpoint and truncate the WAL, so the database file is complete on
    /// its own (before it is renamed).
    pub fn checkpoint_truncate(&self) -> Result<()> {
        let busy: i64 = self
            .conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
        if busy != 0 {
            return Err(Error::Meta("WAL checkpoint could not complete".into()));
        }
        Ok(())
    }

    /// Imports whose status is not `completed`, by id.
    pub fn incomplete_imports(&self) -> Result<Vec<(u64, ImportStatus)>> {
        let mut st = self.conn.prepare_cached(
            "SELECT id, status FROM imports WHERE status != 'completed' ORDER BY id",
        )?;
        let rows: Vec<(i64, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        rows.into_iter()
            .map(|(id, s)| Ok((id as u64, ImportStatus::parse(&s)?)))
            .collect()
    }

    pub fn latest_completed_import(&self) -> Result<Option<u64>> {
        let id: Option<i64> = self.conn.query_row(
            "SELECT max(id) FROM imports WHERE status = 'completed'",
            [],
            |r| r.get(0),
        )?;
        Ok(id.map(|i| i as u64))
    }

    /// Newest message date that is not later than `not_after` (unix seconds).
    pub fn latest_message_date(&self, not_after: i64) -> Result<Option<i64>> {
        Ok(self.conn.query_row(
            "SELECT max(date) FROM messages WHERE date <= ?1",
            [not_after],
            |r| r.get(0),
        )?)
    }

    pub fn count(&self) -> Result<u64> {
        let n: i64 = self
            .conn
            .query_row("SELECT count(*) FROM messages", [], |r| r.get(0))?;
        Ok(n as u64)
    }

    pub fn begin_import(
        &self,
        import_id: u64,
        at: i64,
        source: &str,
        kind: ImportKind,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO imports(id, started_at, source, kind, status) VALUES(?,?,?,?,'running')",
            params![import_id as i64, at, source, kind_str(kind)],
        )?;
        Ok(())
    }

    pub fn set_import_status(&self, import_id: u64, status: ImportStatus) -> Result<()> {
        let n = self.conn.execute(
            "UPDATE imports SET status = ? WHERE id = ?",
            params![status.as_str(), import_id as i64],
        )?;
        if n == 0 {
            return Err(Error::Meta(format!("no import {import_id}")));
        }
        Ok(())
    }

    pub fn import_status(&self, import_id: u64) -> Result<Option<ImportStatus>> {
        let s: Option<String> = self
            .conn
            .query_row(
                "SELECT status FROM imports WHERE id = ?",
                [import_id as i64],
                |r| r.get(0),
            )
            .optional()?;
        s.as_deref().map(ImportStatus::parse).transpose()
    }

    /// The import with the highest id.
    pub fn latest_import(&self) -> Result<Option<(u64, ImportKind, ImportStatus)>> {
        let r: Option<(i64, String, String)> = self
            .conn
            .query_row(
                "SELECT id, kind, status FROM imports ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        r.map(|(id, k, s)| Ok((id as u64, parse_kind(&k)?, ImportStatus::parse(&s)?)))
            .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::RawMessage;
    use crate::parse::{dedupe_keys, parse_message};
    use crate::testing::MsgBuilder;

    struct Fx {
        db: MetaDb,
        _dir: tempfile::TempDir,
    }

    fn fx() -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let db = MetaDb::open(&dir.path().join("meta.sqlite")).unwrap();
        Fx { db, _dir: dir }
    }

    fn mref(n: u64) -> MessageRef {
        MessageRef {
            pack_id: 0,
            offset: n * 100,
            length: 100,
        }
    }

    fn add(db: &MetaDb, b: &MsgBuilder, import: u64) -> MsgId {
        let raw = RawMessage {
            bytes: b.build(),
            from_line_date: None,
        };
        let p = parse_message(&raw).unwrap();
        let k = dedupe_keys(&raw, &p);
        db.insert_message(&p, &k, mref(1), import).unwrap()
    }

    #[test]
    fn insert_and_fetch() {
        let f = fx();
        let b = MsgBuilder::new()
            .from("Alice <alice@example.com>")
            .to("bob@example.com, Carol <carol@example.com>")
            .subject("Hello")
            .message_id(Some("<m1@x>"))
            .thrid(77)
            .labels(&["Inbox", "Work"])
            .text("body text")
            .attach("a.txt", "text/plain", b"hi");
        let id = add(&f.db, &b, 1);
        let m = f.db.message(id).unwrap();
        assert_eq!(m.id, id);
        assert_eq!(m.subject, "Hello");
        assert_eq!(m.thrid, 77);
        assert!(m.message_id.as_deref().unwrap().contains("m1@x"));
        assert_eq!(m.from.as_ref().unwrap().addr, "alice@example.com");
        assert_eq!(m.to.len(), 2);
        assert!(m.has_attachments);
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].filename.as_deref(), Some("a.txt"));
        assert_eq!(m.msg_ref, mref(1));
        assert_eq!((m.first_seen_import, m.last_seen_import), (1, 1));
        let mut l = m.labels.clone();
        l.sort();
        assert_eq!(l, ["Inbox", "Work"]);
        assert!(!m.removed);
        assert_eq!(f.db.count().unwrap(), 1);
        assert_eq!(f.db.latest_message_date(i64::MAX).unwrap(), Some(m.date));
        assert_eq!(f.db.latest_message_date(m.date - 1).unwrap(), None);
    }

    #[test]
    fn apply_helpers() {
        let f = fx();
        let gm = add(&f.db, &MsgBuilder::new().thrid(42).subject("a"), 1);
        let synth = add(&f.db, &MsgBuilder::new().subject("b"), 2);
        assert_eq!(f.db.thrid_of(gm).unwrap(), 42);
        assert_eq!(
            f.db.thrid_of(synth).unwrap(),
            f.db.message(synth).unwrap().thrid
        );
        assert!(f.db.thrid_of(synth).unwrap() < 0);
        assert_eq!(
            f.db.content_key(gm).unwrap(),
            f.db.message(gm).unwrap().content_key
        );
        assert!(f.db.content_key(999).is_err());
        assert!(f.db.removed_ids().unwrap().is_empty());
        f.db.mark_seen(3, &[synth]).unwrap();
        assert_eq!(f.db.removed_ids().unwrap(), vec![synth]);
        f.db.checkpoint().unwrap();
        assert!(f.db.incomplete_imports().unwrap().is_empty());
        assert_eq!(f.db.latest_completed_import().unwrap(), None);
        f.db.begin_import(1, 0, "a", ImportKind::Full).unwrap();
        f.db.begin_import(2, 0, "b", ImportKind::Full).unwrap();
        f.db.begin_import(3, 0, "c", ImportKind::Full).unwrap();
        f.db.set_import_status(1, ImportStatus::Completed).unwrap();
        f.db.set_import_status(3, ImportStatus::Finalizing).unwrap();
        assert_eq!(
            f.db.incomplete_imports().unwrap(),
            vec![(2, ImportStatus::Running), (3, ImportStatus::Finalizing)]
        );
        assert_eq!(f.db.latest_completed_import().unwrap(), Some(1));
    }

    #[test]
    fn thread_ordered_oldest_first() {
        let f = fx();
        let mk = |d: &str, s: &str| MsgBuilder::new().thrid(5).date_rfc2822(d).subject(s);
        add(&f.db, &mk("Wed, 03 Jan 2024 10:00:00 +0000", "third"), 1);
        add(&f.db, &mk("Mon, 01 Jan 2024 10:00:00 +0000", "first"), 1);
        add(&f.db, &mk("Tue, 02 Jan 2024 10:00:00 +0000", "second"), 1);
        add(&f.db, &MsgBuilder::new().thrid(6).subject("other"), 1);
        let t = f.db.thread(5).unwrap();
        let s: Vec<_> = t.iter().map(|m| m.subject.as_str()).collect();
        assert_eq!(s, ["first", "second", "third"]);
    }

    #[test]
    fn labels_replace() {
        let f = fx();
        let id = add(&f.db, &MsgBuilder::new().labels(&["Inbox"]), 1);
        f.db.set_labels(id, &["Starred".into(), "Work".into()])
            .unwrap();
        let mut l = f.db.message(id).unwrap().labels;
        l.sort();
        assert_eq!(l, ["Starred", "Work"]);
        assert_eq!(f.db.top_labels("in", 10).unwrap(), Vec::<String>::new());
        assert_eq!(f.db.top_labels("W", 10).unwrap(), ["Work"]);
    }

    #[test]
    fn key_index_contains_both_keys() {
        let f = fx();
        let b = MsgBuilder::new()
            .message_id(Some("<k@x>"))
            .thrid(9)
            .labels(&["Inbox"]);
        let raw = RawMessage {
            bytes: b.build(),
            from_line_date: None,
        };
        let p = parse_message(&raw).unwrap();
        let k = dedupe_keys(&raw, &p);
        let id = f.db.insert_message(&p, &k, mref(1), 1).unwrap();
        let ki = f.db.key_index().unwrap();
        assert_eq!(ki.by_content[&k.content_key], id);
        let hk = k.header_key.expect("header key");
        assert_eq!(ki.by_header[&hk], vec![(id, Some(9))]);
        assert_eq!(ki.labels[&id], ["Inbox"]);
    }

    #[test]
    fn delete_import_removes_only_that_import() {
        let f = fx();
        f.db.begin_import(1, 100, "a.zip", ImportKind::Full)
            .unwrap();
        f.db.begin_import(2, 200, "b.zip", ImportKind::Partial)
            .unwrap();
        let a = add(
            &f.db,
            &MsgBuilder::new()
                .from("a@x.com")
                .subject("a")
                .labels(&["L1"]),
            1,
        );
        let b = add(
            &f.db,
            &MsgBuilder::new()
                .from("b@x.com")
                .subject("b")
                .labels(&["L2"])
                .attach("f", "text/plain", b"z"),
            2,
        );
        f.db.delete_import(2).unwrap();
        assert_eq!(f.db.count().unwrap(), 1);
        assert!(f.db.message(a).is_ok());
        assert!(f.db.message(b).is_err());
        assert_eq!(f.db.top_labels("", 10).unwrap(), ["L1"]);
        let addrs = f.db.top_addresses("", 10).unwrap();
        assert!(addrs.iter().all(|x| x.addr != "b@x.com"));
        assert!(addrs.iter().any(|x| x.addr == "a@x.com"));
        assert_eq!(f.db.import_status(2).unwrap(), None);
        assert_eq!(f.db.latest_import().unwrap().unwrap().0, 1);
        let n: i64 =
            f.db.conn
                .query_row("SELECT count(*) FROM attachments", [], |r| r.get(0))
                .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn top_addresses_ranked_by_frequency() {
        let f = fx();
        for i in 0..3 {
            add(
                &f.db,
                &MsgBuilder::new()
                    .from("bob@x.com")
                    .subject(&format!("s{i}")),
                1,
            );
        }
        add(&f.db, &MsgBuilder::new().from("Bea Smith <zed@x.com>"), 1);
        add(&f.db, &MsgBuilder::new().from("Carl <carl@x.com>"), 1);
        let r = f.db.top_addresses("b", 10).unwrap();
        assert_eq!(r[0].addr, "bob@x.com");
        assert_eq!(r[1].addr, "zed@x.com"); // matched via display-name word "Bea"
        assert_eq!(r.len(), 2);
        let r = f.db.top_addresses("SMI", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(f.db.top_addresses("b", 1).unwrap().len(), 1);
        // LIKE wildcards are literal
        assert!(f.db.top_addresses("%", 10).unwrap().is_empty());
    }

    #[test]
    fn removed_flag() {
        let f = fx();
        let a = add(&f.db, &MsgBuilder::new().subject("a"), 1);
        let b = add(&f.db, &MsgBuilder::new().subject("b"), 1);
        f.db.mark_seen(2, &[a]).unwrap();
        let (ra, rb) = (f.db.message(a).unwrap(), f.db.message(b).unwrap());
        assert!(ra.removed && !rb.removed);
        assert_eq!((ra.last_seen_import, rb.last_seen_import), (1, 2));
        // a reappears in a later import: flag clears
        f.db.mark_seen(3, &[b]).unwrap();
        let (ra, rb) = (f.db.message(a).unwrap(), f.db.message(b).unwrap());
        assert!(!ra.removed && rb.removed);
        assert_eq!((ra.last_seen_import, rb.last_seen_import), (3, 2));
    }

    #[test]
    fn fallback_thread_from_references() {
        let f = fx();
        add(
            &f.db,
            &MsgBuilder::new().message_id(Some("<root@x>")).thrid(42),
            1,
        );
        let reply = add(
            &f.db,
            &MsgBuilder::new()
                .message_id(Some("<r1@x>"))
                .raw_header("References", "<root@x> <mid@x>")
                .raw_header("In-Reply-To", "<mid@x>"),
            1,
        );
        assert_eq!(f.db.message(reply).unwrap().thrid, 42);
        let irt = add(
            &f.db,
            &MsgBuilder::new()
                .message_id(Some("<r2@x>"))
                .raw_header("In-Reply-To", "<root@x>"),
            1,
        );
        assert_eq!(f.db.message(irt).unwrap().thrid, 42);
        let lone = add(&f.db, &MsgBuilder::new().message_id(Some("<l@x>")), 1);
        assert_eq!(f.db.message(lone).unwrap().thrid, -lone);
    }

    #[test]
    fn import_status_lifecycle() {
        let f = fx();
        assert_eq!(f.db.latest_import().unwrap(), None);
        f.db.begin_import(1, 10, "s", ImportKind::Full).unwrap();
        assert_eq!(f.db.import_status(1).unwrap(), Some(ImportStatus::Running));
        f.db.set_import_status(1, ImportStatus::Finalizing).unwrap();
        f.db.begin_import(2, 20, "t", ImportKind::Partial).unwrap();
        f.db.set_import_status(1, ImportStatus::Completed).unwrap();
        assert_eq!(
            f.db.latest_import().unwrap(),
            Some((2, ImportKind::Partial, ImportStatus::Running))
        );
    }

    #[test]
    fn transaction_commits_and_rolls_back() {
        let f = fx();
        let r: Result<()> = f.db.transaction(|| {
            add(&f.db, &MsgBuilder::new().subject("x"), 1);
            Err(Error::Meta("boom".into()))
        });
        assert!(r.is_err());
        assert_eq!(f.db.count().unwrap(), 0);
        // the connection is back in autocommit: the next transaction commits
        assert!(f.db.conn.is_autocommit());
        f.db.transaction(|| {
            add(&f.db, &MsgBuilder::new().subject("x"), 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(f.db.count().unwrap(), 1);
    }

    #[test]
    fn transaction_rolls_back_on_panic() {
        let f = fx();
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _: Result<()> = f.db.transaction(|| {
                add(&f.db, &MsgBuilder::new().subject("x"), 1);
                panic!("boom");
            });
        }));
        assert!(r.is_err());
        assert!(f.db.conn.is_autocommit());
        assert_eq!(f.db.count().unwrap(), 0);
        f.db.transaction(|| {
            add(&f.db, &MsgBuilder::new().subject("y"), 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(f.db.count().unwrap(), 1);
    }

    #[test]
    fn shared_address_survives_delete_of_one_import() {
        let f = fx();
        add(
            &f.db,
            &MsgBuilder::new().from("Shared <s@x.com>").subject("1"),
            1,
        );
        add(
            &f.db,
            &MsgBuilder::new().from("Shared <s@x.com>").subject("2"),
            2,
        );
        add(
            &f.db,
            &MsgBuilder::new().from("Shared <s@x.com>").subject("3"),
            2,
        );
        let count = |f: &Fx| -> i64 {
            f.db.conn
                .query_row(
                    "SELECT count FROM addresses WHERE addr='s@x.com'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert_eq!(count(&f), 3);
        f.db.delete_import(2).unwrap();
        assert_eq!(count(&f), 1);
        assert_eq!(f.db.top_addresses("s", 5).unwrap().len(), 1);
        f.db.delete_import(1).unwrap();
        assert!(f.db.top_addresses("s", 5).unwrap().is_empty());
    }

    #[test]
    fn top_addresses_folds_diacritics_and_word_boundaries() {
        let f = fx();
        add(
            &f.db,
            &MsgBuilder::new().from("=?utf-8?Q?=C3=89mile?= Zola <ez@x.com>"),
            1,
        );
        add(
            &f.db,
            &MsgBuilder::new().from("\"Anne-Marie\" <am@x.com>"),
            1,
        );
        add(&f.db, &MsgBuilder::new().from("\"O'Brien\" <ob@x.com>"), 1);
        for q in ["emile", "émile", "ÉMI", "zola"] {
            let r = f.db.top_addresses(q, 5).unwrap();
            assert_eq!(r.len(), 1, "{q}");
            assert_eq!(r[0].addr, "ez@x.com");
        }
        assert_eq!(f.db.top_addresses("marie", 5).unwrap()[0].addr, "am@x.com");
        assert_eq!(f.db.top_addresses("brien", 5).unwrap()[0].addr, "ob@x.com");
    }

    #[test]
    fn reopen_keeps_data_and_schema_version() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("meta.sqlite");
        {
            let db = MetaDb::open(&p).unwrap();
            add(&db, &MsgBuilder::new(), 1);
        }
        let db = MetaDb::open(&p).unwrap();
        assert_eq!(db.count().unwrap(), 1);
        let v: i64 = db
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
    }

    #[test]
    #[ignore]
    fn insert_perf() {
        let f = fx();
        let n = 50_000u64;
        let msgs: Vec<(ParsedMessage, DedupeKeys)> = (0..n)
            .map(|i| {
                let raw = RawMessage {
                    bytes: MsgBuilder::new()
                        .subject(&format!("subject {i}"))
                        .to("bob@example.com")
                        .message_id(Some(&format!("<{i}@x>")))
                        .thrid(i / 3)
                        .labels(&["Inbox", "Work"])
                        .build(),
                    from_line_date: None,
                };
                let p = parse_message(&raw).unwrap();
                let k = dedupe_keys(&raw, &p);
                (p, k)
            })
            .collect();
        let t = std::time::Instant::now();
        for chunk in msgs.chunks(5000) {
            f.db.transaction(|| {
                for (p, k) in chunk {
                    f.db.insert_message(p, k, mref(1), 1)?;
                }
                Ok(())
            })
            .unwrap();
        }
        let s = t.elapsed().as_secs_f64();
        let rate = n as f64 / s;
        println!("inserted {n} in {s:.2}s = {rate:.0}/s");
        assert!(rate > 20_000.0, "insert rate {rate:.0}/s");
    }

    #[test]
    #[ignore]
    fn mark_seen_perf_500k() {
        let f = fx();
        let raw = RawMessage {
            bytes: MsgBuilder::new().subject("s").build(),
            from_line_date: None,
        };
        let p = parse_message(&raw).unwrap();
        let k0 = dedupe_keys(&raw, &p);
        let n = 500_000u32;
        let mut ids = Vec::new();
        for chunk in (0..n).collect::<Vec<_>>().chunks(5000) {
            f.db.transaction(|| {
                for &i in chunk {
                    let mut k = k0.clone();
                    k.content_key[..4].copy_from_slice(&i.to_be_bytes());
                    k.header_key = None;
                    ids.push(f.db.insert_message(&p, &k, mref(1), 1)?);
                }
                Ok(())
            })
            .unwrap();
        }
        let absent: Vec<MsgId> = ids.iter().copied().step_by(10).collect();
        let t = std::time::Instant::now();
        f.db.mark_seen(2, &absent).unwrap();
        let s = t.elapsed().as_secs_f64();
        println!("mark_seen over {n} rows ({} absent): {s:.2}s", absent.len());
        assert!(s < 5.0, "mark_seen took {s:.2}s");
        assert!(f.db.message(absent[0]).unwrap().removed);
        assert!(!f.db.message(ids[1]).unwrap().removed);
    }
}
