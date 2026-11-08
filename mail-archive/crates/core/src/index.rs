//! Tantivy search index (a rebuildable cache over the store + SQLite).
//!
//! # Contract for the query layer (Tasks 7/8)
//!
//! Tokenizers (registered on every open under these names):
//! - [`TOK_TEXT`] `"text_folded"`: split on non-alphanumerics, lowercase,
//!   ASCII-fold (`Café` -> `cafe`). No stemming, no stop words.
//! - [`TOK_ADDR`] `"addr"`: same pipeline; used for address fields so
//!   `orders@amazon.com` -> `orders`, `amazon`, `com` (positions kept, so
//!   the phrase `"amazon.com"` matches).
//! - [`TOK_LABEL`] `"label"`: the whole value as ONE token, lowercased and
//!   ASCII-folded (`Receipts 2019` -> `receipts 2019`).
//!
//! Fields (see [`Fields`]; names are the `F_*` constants):
//! - `msg_id` i64, `thrid` i64, `import_id` u64, `date` i64 (unix secs),
//!   `size` u64, `has_attachment` bool, `removed` bool: all indexed + fast;
//!   only `msg_id` is also stored.
//! - `subject`, `body`, `filenames`: text, [`TOK_TEXT`], positions.
//! - `from`, `to`, `cc`, `bcc`: text, [`TOK_ADDR`], positions. Each holds
//!   display name and address (`José Café <jose@x.com>`).
//! - `labels`: text, [`TOK_LABEL`], one value per label.
//!
//! Use [`SearchIndex::tokenize`] to normalize user input with a field's
//! analyzer. Bump [`SCHEMA_VERSION`] whenever any of this changes.
//!
//! Files tantivy creates inside the index dir are chmodded to 0600 after each
//! commit (not at creation time, so a short window of default permissions
//! exists; the 0700 directory protects them meanwhile).

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use tantivy::schema::{
    Field, IndexRecordOption, NumericOptions, Schema, TextFieldIndexing, TextOptions,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RawTokenizer, RemoveLongFilter, SimpleTokenizer, TextAnalyzer,
};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, Searcher, TantivyDocument, Term};

use crate::Result;
use crate::model::{Address, MsgId, ParsedMessage};
use crate::paths::{create_private_dir, create_private_file};

pub const SCHEMA_VERSION: u32 = 1;
const VERSION_FILE: &str = "VERSION";
const WRITER_BUDGET: usize = 256 * 1024 * 1024;
const WRITER_THREADS: usize = 4;

pub const TOK_TEXT: &str = "text_folded";
pub const TOK_ADDR: &str = "addr";
pub const TOK_LABEL: &str = "label";

pub const F_MSG_ID: &str = "msg_id";
pub const F_THRID: &str = "thrid";
pub const F_IMPORT_ID: &str = "import_id";
pub const F_DATE: &str = "date";
pub const F_SIZE: &str = "size";
pub const F_SUBJECT: &str = "subject";
pub const F_BODY: &str = "body";
pub const F_FROM: &str = "from";
pub const F_TO: &str = "to";
pub const F_CC: &str = "cc";
pub const F_BCC: &str = "bcc";
pub const F_FILENAMES: &str = "filenames";
pub const F_LABELS: &str = "labels";
pub const F_HAS_ATTACHMENT: &str = "has_attachment";
pub const F_REMOVED: &str = "removed";

/// Field handles for building queries.
#[derive(Clone, Debug)]
pub struct Fields {
    pub msg_id: Field,
    pub thrid: Field,
    pub import_id: Field,
    pub date: Field,
    pub size: Field,
    pub subject: Field,
    pub body: Field,
    pub from: Field,
    pub to: Field,
    pub cc: Field,
    pub bcc: Field,
    pub filenames: Field,
    pub labels: Field,
    pub has_attachment: Field,
    pub removed: Field,
}

fn build_schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let num = || NumericOptions::default().set_indexed().set_fast();
    let text = |tok: &str| {
        TextOptions::default().set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer(tok)
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
    };
    let f = Fields {
        msg_id: b.add_i64_field(F_MSG_ID, num().set_stored()),
        thrid: b.add_i64_field(F_THRID, num()),
        import_id: b.add_u64_field(F_IMPORT_ID, num()),
        date: b.add_i64_field(F_DATE, num()),
        size: b.add_u64_field(F_SIZE, num()),
        subject: b.add_text_field(F_SUBJECT, text(TOK_TEXT)),
        body: b.add_text_field(F_BODY, text(TOK_TEXT)),
        from: b.add_text_field(F_FROM, text(TOK_ADDR)),
        to: b.add_text_field(F_TO, text(TOK_ADDR)),
        cc: b.add_text_field(F_CC, text(TOK_ADDR)),
        bcc: b.add_text_field(F_BCC, text(TOK_ADDR)),
        filenames: b.add_text_field(F_FILENAMES, text(TOK_TEXT)),
        labels: b.add_text_field(F_LABELS, text(TOK_LABEL)),
        has_attachment: b.add_bool_field(F_HAS_ATTACHMENT, num()),
        removed: b.add_bool_field(F_REMOVED, num()),
    };
    (b.build(), f)
}

fn register_tokenizers(index: &Index) {
    let m = index.tokenizers();
    let words = || {
        TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(RemoveLongFilter::limit(255))
            .filter(LowerCaser)
            .filter(AsciiFoldingFilter)
            .build()
    };
    m.register(TOK_TEXT, words());
    m.register(TOK_ADDR, words());
    m.register(
        TOK_LABEL,
        TextAnalyzer::builder(RawTokenizer::default())
            .filter(RemoveLongFilter::limit(255))
            .filter(LowerCaser)
            .filter(AsciiFoldingFilter)
            .build(),
    );
}

/// Document to index (one per message).
#[derive(Clone, Debug, Default)]
pub struct IndexDoc {
    pub msg_id: MsgId,
    pub thrid: i64,
    pub import_id: u64,
    pub date: i64,
    pub size: u64,
    pub subject: String,
    pub body: String,
    pub from: String,
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub filenames: String,
    pub labels: Vec<String>,
    pub has_attachment: bool,
    pub removed: bool,
}

fn fmt_addr(a: &Address) -> String {
    match &a.name {
        Some(n) if !n.is_empty() => format!("{n} <{}>", a.addr),
        _ => a.addr.clone(),
    }
}

fn fmt_addrs(v: &[Address]) -> String {
    v.iter().map(fmt_addr).collect::<Vec<_>>().join(", ")
}

impl IndexDoc {
    pub fn from_parsed(
        id: MsgId,
        thrid: i64,
        import_id: u64,
        p: &ParsedMessage,
        removed: bool,
    ) -> IndexDoc {
        IndexDoc {
            msg_id: id,
            thrid,
            import_id,
            date: p.date,
            size: p.size,
            subject: p.subject.clone(),
            body: p.body_text.clone(),
            from: p.from.as_ref().map(fmt_addr).unwrap_or_default(),
            to: fmt_addrs(&p.to),
            cc: fmt_addrs(&p.cc),
            bcc: fmt_addrs(&p.bcc),
            filenames: p
                .attachments
                .iter()
                .filter_map(|a| a.filename.as_deref())
                .collect::<Vec<_>>()
                .join(" "),
            labels: p.labels.clone(),
            has_attachment: !p.attachments.is_empty(),
            removed,
        }
    }
}

pub enum OpenedIndex {
    Ready(SearchIndex),
    /// The on-disk schema version differs; the caller should wipe and rebuild.
    NeedsRebuild(SearchIndex),
}

pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    fields: Fields,
    path: PathBuf,
}

impl SearchIndex {
    pub fn open_or_create(dir: &Path) -> Result<OpenedIndex> {
        create_private_dir(dir)?;
        let (schema, fields) = build_schema();
        let existing = dir.join("meta.json").exists();
        let index = if existing {
            Index::open_in_dir(dir)?
        } else {
            Index::create_in_dir(dir, schema)?
        };
        register_tokenizers(&index);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let vpath = dir.join(VERSION_FILE);
        let ready = if existing {
            fs::read_to_string(&vpath)
                .ok()
                .and_then(|s| s.trim().parse::<u32>().ok())
                == Some(SCHEMA_VERSION)
        } else {
            use std::io::Write;
            let mut f = create_private_file(&vpath)?;
            f.set_len(0)?;
            write!(f, "{SCHEMA_VERSION}")?;
            true
        };
        // Handles come from our schema; an index of another version may differ.
        let fields = if ready {
            fields
        } else {
            fields_from(index.schema()).unwrap_or(fields)
        };
        let si = SearchIndex {
            index,
            reader,
            fields,
            path: dir.to_path_buf(),
        };
        Ok(if ready {
            OpenedIndex::Ready(si)
        } else {
            OpenedIndex::NeedsRebuild(si)
        })
    }

    pub fn fields(&self) -> &Fields {
        &self.fields
    }

    /// A searcher reflecting the last commit made through a writer handle.
    pub fn searcher(&self) -> Searcher {
        self.reader.searcher()
    }

    pub fn writer(&self) -> Result<IndexWriterHandle> {
        self.writer_with(WRITER_BUDGET, WRITER_THREADS)
    }

    pub(crate) fn writer_with(&self, budget: usize, threads: usize) -> Result<IndexWriterHandle> {
        Ok(IndexWriterHandle {
            writer: self.index.writer_with_num_threads(threads, budget)?,
            reader: self.reader.clone(),
            fields: self.fields.clone(),
            path: self.path.clone(),
        })
    }

    /// Normalize `text` with the analyzer of `field`, as indexing would.
    pub fn tokenize(&self, field: Field, text: &str) -> Vec<String> {
        let Some(name) = text_tokenizer_name(&self.index.schema(), field) else {
            return Vec::new();
        };
        let Some(mut analyzer) = self.index.tokenizers().get(&name) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut stream = analyzer.token_stream(text);
        while stream.advance() {
            out.push(stream.token().text.clone());
        }
        out
    }
}

fn text_tokenizer_name(schema: &Schema, field: Field) -> Option<String> {
    match schema.get_field_entry(field).field_type() {
        tantivy::schema::FieldType::Str(o) => {
            o.get_indexing_options().map(|i| i.tokenizer().to_string())
        }
        _ => None,
    }
}

fn fields_from(schema: Schema) -> Option<Fields> {
    let g = |n: &str| schema.get_field(n).ok();
    Some(Fields {
        msg_id: g(F_MSG_ID)?,
        thrid: g(F_THRID)?,
        import_id: g(F_IMPORT_ID)?,
        date: g(F_DATE)?,
        size: g(F_SIZE)?,
        subject: g(F_SUBJECT)?,
        body: g(F_BODY)?,
        from: g(F_FROM)?,
        to: g(F_TO)?,
        cc: g(F_CC)?,
        bcc: g(F_BCC)?,
        filenames: g(F_FILENAMES)?,
        labels: g(F_LABELS)?,
        has_attachment: g(F_HAS_ATTACHMENT)?,
        removed: g(F_REMOVED)?,
    })
}

pub struct IndexWriterHandle {
    writer: IndexWriter,
    reader: IndexReader,
    fields: Fields,
    path: PathBuf,
}

impl IndexWriterHandle {
    /// Insert or replace the document for `d.msg_id`.
    pub fn upsert(&mut self, d: &IndexDoc) -> Result<()> {
        let f = &self.fields;
        self.writer
            .delete_term(Term::from_field_i64(f.msg_id, d.msg_id));
        let mut doc = TantivyDocument::default();
        doc.add_i64(f.msg_id, d.msg_id);
        doc.add_i64(f.thrid, d.thrid);
        doc.add_u64(f.import_id, d.import_id);
        doc.add_i64(f.date, d.date);
        doc.add_u64(f.size, d.size);
        doc.add_text(f.subject, &d.subject);
        doc.add_text(f.body, &d.body);
        doc.add_text(f.from, &d.from);
        doc.add_text(f.to, &d.to);
        doc.add_text(f.cc, &d.cc);
        doc.add_text(f.bcc, &d.bcc);
        doc.add_text(f.filenames, &d.filenames);
        for l in &d.labels {
            doc.add_text(f.labels, l);
        }
        doc.add_bool(f.has_attachment, d.has_attachment);
        doc.add_bool(f.removed, d.removed);
        self.writer.add_document(doc)?;
        Ok(())
    }

    /// Delete every document belonging to `import_id` (takes effect on commit).
    pub fn delete_import(&mut self, import_id: u64) -> Result<()> {
        self.writer
            .delete_term(Term::from_field_u64(self.fields.import_id, import_id));
        Ok(())
    }

    /// Commit and make the result visible to `SearchIndex::searcher`.
    pub fn commit(&mut self) -> Result<()> {
        self.writer.commit()?;
        self.reader.reload()?;
        restrict_permissions(&self.path);
        Ok(())
    }
}

fn restrict_permissions(dir: &Path) {
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.file_type().is_ok_and(|t| t.is_file()) {
                let _ = fs::set_permissions(e.path(), fs::Permissions::from_mode(0o600));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tantivy::collector::Count;
    use tantivy::query::{PhraseQuery, TermQuery};
    use tantivy::schema::IndexRecordOption;

    const SMALL: usize = 20_000_000;

    fn open(dir: &Path) -> SearchIndex {
        match SearchIndex::open_or_create(dir).unwrap() {
            OpenedIndex::Ready(i) => i,
            OpenedIndex::NeedsRebuild(_) => panic!("unexpected rebuild"),
        }
    }

    fn doc(id: i64) -> IndexDoc {
        IndexDoc {
            msg_id: id,
            thrid: id,
            import_id: 1,
            ..Default::default()
        }
    }

    fn hits(si: &SearchIndex, field: Field, text: &str) -> usize {
        let q = TermQuery::new(Term::from_field_text(field, text), IndexRecordOption::Basic);
        si.searcher().search(&q, &Count).unwrap()
    }

    fn put(si: &SearchIndex, docs: &[IndexDoc]) {
        let mut w = si.writer_with(SMALL, 1).unwrap();
        for d in docs {
            w.upsert(d).unwrap();
        }
        w.commit().unwrap();
    }

    #[test]
    fn accent_and_case_insensitive() {
        let t = tempfile::tempdir().unwrap();
        let si = open(&t.path().join("idx"));
        let mut d = doc(1);
        d.from = "José Café <jose@x.com>".into();
        d.subject = "Café".into();
        put(&si, &[d]);
        let f = si.fields();
        assert_eq!(hits(&si, f.from, "jose"), 1);
        assert_eq!(hits(&si, f.from, "cafe"), 1);
        assert_eq!(hits(&si, f.subject, "cafe"), 1);
        assert_eq!(hits(&si, f.subject, "café"), 0);
        assert_eq!(
            si.tokenize(f.subject, "CAFÉ au Lait"),
            ["cafe", "au", "lait"]
        );
    }

    #[test]
    fn address_tokenized() {
        let t = tempfile::tempdir().unwrap();
        let si = open(&t.path().join("idx"));
        let mut d = doc(1);
        d.from = "orders@amazon.com".into();
        put(&si, &[d]);
        let f = si.fields();
        for tok in ["amazon", "orders", "com"] {
            assert_eq!(hits(&si, f.from, tok), 1, "{tok}");
        }
        let terms = si
            .tokenize(f.from, "amazon.com")
            .into_iter()
            .map(|s| Term::from_field_text(f.from, &s))
            .collect();
        assert_eq!(
            si.searcher()
                .search(&PhraseQuery::new(terms), &Count)
                .unwrap(),
            1
        );
    }

    #[test]
    fn upsert_replaces() {
        let t = tempfile::tempdir().unwrap();
        let si = open(&t.path().join("idx"));
        let mut d = doc(7);
        d.labels = vec!["Inbox".into()];
        put(&si, &[d.clone()]);
        d.labels = vec!["Receipts 2019".into()];
        put(&si, &[d]);
        let f = si.fields();
        assert_eq!(si.searcher().num_docs(), 1);
        assert_eq!(hits(&si, f.labels, "inbox"), 0);
        assert_eq!(hits(&si, f.labels, "receipts 2019"), 1);
    }

    #[test]
    fn labels_exact_lowercased() {
        let t = tempfile::tempdir().unwrap();
        let si = open(&t.path().join("idx"));
        let f = si.fields();
        assert_eq!(si.tokenize(f.labels, "Receipts 2019"), ["receipts 2019"]);
        let mut d = doc(1);
        d.labels = vec!["Receipts 2019".into(), "Café".into()];
        put(&si, &[d]);
        assert_eq!(hits(&si, f.labels, "receipts 2019"), 1);
        assert_eq!(hits(&si, f.labels, "receipts"), 0);
        assert_eq!(hits(&si, f.labels, "cafe"), 1);
    }

    #[test]
    fn delete_import() {
        let t = tempfile::tempdir().unwrap();
        let si = open(&t.path().join("idx"));
        let mut b = doc(2);
        b.import_id = 2;
        put(&si, &[doc(1), b]);
        let mut w = si.writer_with(SMALL, 1).unwrap();
        w.delete_import(1).unwrap();
        w.commit().unwrap();
        let f = si.fields();
        assert_eq!(si.searcher().num_docs(), 1);
        let by_import = |id: u64| {
            let q = TermQuery::new(
                Term::from_field_u64(f.import_id, id),
                IndexRecordOption::Basic,
            );
            si.searcher().search(&q, &Count).unwrap()
        };
        assert_eq!(by_import(1), 0);
        assert_eq!(by_import(2), 1);
    }

    #[test]
    fn schema_mismatch_needs_rebuild() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("idx");
        drop(open(&dir));
        fs::write(dir.join(VERSION_FILE), "0").unwrap();
        assert!(matches!(
            SearchIndex::open_or_create(&dir).unwrap(),
            OpenedIndex::NeedsRebuild(_)
        ));
        fs::write(dir.join(VERSION_FILE), SCHEMA_VERSION.to_string()).unwrap();
        assert!(matches!(
            SearchIndex::open_or_create(&dir).unwrap(),
            OpenedIndex::Ready(_)
        ));
    }

    #[test]
    fn persists_and_is_private() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("idx");
        let si = open(&dir);
        let mut d = doc(1);
        d.subject = "hello".into();
        put(&si, &[d]);
        drop(si);
        let si = open(&dir);
        assert_eq!(hits(&si, si.fields().subject, "hello"), 1);
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&dir.join(VERSION_FILE)), 0o600);
        assert_eq!(mode(&dir.join("meta.json")), 0o600);
    }
}
