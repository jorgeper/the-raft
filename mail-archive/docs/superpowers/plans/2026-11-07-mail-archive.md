# Mail Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully local macOS app that imports Gmail Takeout mbox exports into its own library and lets you search them with Gmail-style queries and read the results.

**Architecture:** A Rust library crate (`mail-core`) owns everything: mbox streaming, parsing, an append-only zstd message store, an append-only event log (source of truth with the store), SQLite metadata, a Tantivy index, the query parser/executor, import (scan → confirm → apply), rebuild, and HTML sanitizing. A thin CLI (`mail-cli`) exercises the core against real data before any UI exists. A Tauri 2 app (`app/`) exposes the core over IPC to a Svelte + TypeScript front end with the "search-first" layout.

**Tech Stack:** Rust 1.96 (edition 2024), Cargo workspace; crates: `mail-parser`, `zip` (zip64 streaming), `zstd`, `rusqlite` (bundled), `tantivy`, `sha2`, `serde`/`serde_json`, `chrono`, `ammonia`, `lol_html`, `rayon`, `thiserror`, `clap`, `tempfile` (dev). Tauri 2, Svelte 5, TypeScript, Vite, Vitest. Node 22 + pnpm. Use the latest stable version of each crate/package at build time and commit the lockfiles.

**Spec:** `docs/superpowers/specs/2026-11-07-mail-archive-design.md` — read it before starting any task.

## Global Constraints

- **Zero network traffic** from the app: no telemetry, updater, crash reporter, remote fonts/CDNs, remote images, link prefetch. No Tauri plugins that make network requests.
- Email bodies render in a sandboxed iframe (no scripts, no forms, no same-origin) with its own CSP; remote images replaced by a neutral placeholder; **no "load images" button**.
- Links open in the default browser only on explicit click.
- Default library: `~/Library/Application Support/mail-archive/library/`; warn if the chosen path is inside Dropbox, iCloud Drive, Google Drive, or OneDrive.
- Library files: dirs `0700`, files `0600`. **No app-level encryption at rest.**
- Logs never include message bodies or addresses.
- A message once imported is never removed by a later import.
- Spam and Trash are excluded from results unless the query uses `in:spam`, `in:trash`, or `in:anywhere`.
- Dates are interpreted and displayed in the Mac's local time zone; `before:` is exclusive.
- No real mail is ever committed; tests use synthetic fixtures only.
- Performance targets (real archive, Apple Silicon): query → first results **< 100 ms**; open conversation **< 50 ms**; cold launch to usable search **< 1 s**; full first import **< 30 min**; steady-state memory **< 500 MB**.

## Review Focus

1. **Malformed messages inside a 24 GB mbox** (broken MIME, unknown charset, truncated final message, binary junk) — import must skip-and-count, never abort. Pinned in Task 2 (`parse_never_panics_on_garbage`) and Task 9 (`scan_counts_parse_errors_and_continues`).
2. **Half-typed queries while typing** (`from:`, unclosed `"`, unbalanced `(`, trailing `-`, `OR` at end) — never an error; degrade to plain text. Pinned in Task 7 (`partial_queries_never_fail`).
3. **Missing or garbage `Date:` header** — fall back to the mbox `From_` line date so the message still sorts and filters by date. Pinned in Task 2 (`date_falls_back_to_from_line`).
4. **Accented and mixed-case names/addresses** — `from:jose` finds "José", `subject:cafe` finds "Café". Pinned in Task 6 (`accent_and_case_insensitive`).
5. **Two different messages sharing a Message-ID in the same Takeout** (mass mailers) — both kept, neither treated as a duplicate of the other. Pinned in Task 9 (`colliding_message_ids_both_new`).

---

## File Structure

```
Cargo.toml                       workspace: crates/core, crates/cli, app/src-tauri
crates/core/src/
  lib.rs                         re-exports; Error type (thiserror)
  model.rs                       shared data types (below)
  testing.rs                     synthetic fixture builders (cfg(any(test, feature="testing")))
  mbox.rs                        streaming mboxrd reader
  parse.rs                       RFC 822 → ParsedMessage, Gmail headers, dedupe keys
  store.rs                       append-only zstd pack files
  events.rs                      append-only event log (JSON lines)
  meta.rs                        SQLite schema + queries
  index.rs                       Tantivy schema, tokenizers, writer/reader
  query/parse.rs                 Gmail query → Expr AST + chips + hints
  query/exec.rs                  Expr → Tantivy query, thread grouping
  import/source.rs               open zip/mbox sources, full vs partial
  import/scan.rs                 classification → ScanReport + ImportPlan
  import/apply.rs                apply plan, batching, rollback of incomplete imports
  rebuild.rs                     rebuild SQLite + index from store + event log
  render.rs                      sanitize HTML, remote-content strip, cid rewrite, highlight
  library.rs                     Library facade used by CLI and app
  paths.rs                       default paths, cloud-sync detection, permissions
crates/cli/src/main.rs           `mail-cli import|search|rebuild|bench`
app/src-tauri/                   Tauri 2 shell: commands.rs, protocol.rs, config.rs
app/src/                         Svelte front end
  lib/api.ts  lib/chips.ts  lib/keys.ts
  components/SearchBox.svelte ChipRow.svelte ResultsList.svelte ReadingPane.svelte
             ImportDialog.svelte FirstRun.svelte
```

### Shared types (`crates/core/src/model.rs`) — every task uses these names

```rust
pub type MsgId = i64;                 // SQLite rowid
pub type Key = [u8; 32];              // SHA-256

pub struct RawMessage { pub bytes: Vec<u8>, pub from_line_date: Option<i64> } // From_ line stripped, mboxrd-unescaped
pub struct Address { pub name: Option<String>, pub addr: String }
pub struct AttachmentInfo { pub part_index: u32, pub filename: Option<String>, pub mime_type: String, pub size: u64, pub content_id: Option<String> }
pub struct ParsedMessage {
    pub thrid: Option<u64>, pub labels: Vec<String>,
    pub message_id: Option<String>, pub in_reply_to: Option<String>, pub references: Vec<String>,
    pub date: i64,                    // unix seconds UTC
    pub from: Option<Address>, pub to: Vec<Address>, pub cc: Vec<Address>, pub bcc: Vec<Address>,
    pub subject: String, pub body_text: String, pub snippet: String,   // snippet ≤ 200 chars
    pub attachments: Vec<AttachmentInfo>, pub size: u64,
}
pub struct DedupeKeys { pub content_key: Key, pub header_key: Option<Key> }
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct MessageRef { pub pack_id: u32, pub offset: u64, pub length: u32 }
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub enum ImportKind { Full, Partial }
```

All public types that cross IPC derive `Serialize` (and `Deserialize` where the UI sends them).

---

### Task 1: Workspace, fixtures, and the mbox reader

**Files:**
- Create: `Cargo.toml`, `crates/core/Cargo.toml`, `crates/core/src/{lib.rs,model.rs,testing.rs,mbox.rs}`, `rust-toolchain.toml` (`channel = "1.96"`), `README.md` (one paragraph + how to run tests)
- Test: `crates/core/src/mbox.rs` (unit tests)

**Interfaces:**
- Produces:
  - `testing::MsgBuilder` — chainable: `new()`, `from(&str)`, `to(&str)`, `cc(&str)`, `subject(&str)`, `date_rfc2822(&str)`, `no_date()`, `message_id(Option<&str>)`, `thrid(u64)`, `labels(&[&str])`, `text(&str)`, `html(&str)`, `attach(name: &str, mime: &str, bytes: &[u8])`, `inline_image(cid: &str, bytes: &[u8])`, `raw_header(name, value)`, `build() -> Vec<u8>` (RFC 822 bytes)
  - `testing::mbox_of(msgs: &[Vec<u8>]) -> Vec<u8>` — adds `From 123@xxx Sun Nov 01 20:09:16 +0000 2026` lines and mboxrd-escapes body lines matching `^>*From `
  - `testing::zip_of(entry_name: &str, bytes: &[u8]) -> Vec<u8>`
  - `mbox::MboxReader<R: BufRead>::new(r: R)`, `impl Iterator<Item = io::Result<RawMessage>>`

- [ ] **Step 1: Write failing tests** in `mbox.rs`:
  - `splits_three_messages`: `mbox_of` 3 built messages → reader yields 3; each `bytes` equals the original `build()` output exactly.
  - `unescapes_mboxrd`: body containing `From here` and `>From there` round-trips unchanged.
  - `parses_from_line_date`: `from_line_date == Some(1793563756)` for `Sun Nov 01 20:09:16 +0000 2026`.
  - `truncated_last_message_is_yielded`: mbox cut mid-body still yields the partial last message, no error.
  - `crlf_input_supported`: same mbox with `\r\n` line endings yields the same message count.
- [ ] **Step 2:** `cargo test -p mail-core mbox` → FAIL (not defined).
- [ ] **Step 3: Implement** workspace, `model.rs` (types above), `testing.rs`, and `MboxReader`. A new message starts only at a line beginning `From ` that follows an empty line or start of file; un-escape by removing one `>` from lines matching `^>+From `. Read with a reusable line buffer (no per-message regex).
- [ ] **Step 4:** `cargo test -p mail-core` → PASS.
- [ ] **Step 5: Commit** `feat(core): workspace, fixture builders, mboxrd reader`.

---

### Task 2: Message parsing and dedupe keys

**Files:**
- Create: `crates/core/src/parse.rs`
- Test: unit tests in `parse.rs`

**Interfaces:**
- Consumes: `RawMessage`, `MsgBuilder`
- Produces:
  - `parse::parse_message(raw: &RawMessage) -> Result<ParsedMessage, ParseError>`
  - `parse::parse_gmail_labels(value: &str) -> Vec<String>`
  - `parse::dedupe_keys(raw: &RawMessage, parsed: &ParsedMessage) -> DedupeKeys`
  - `parse::html_body(bytes: &[u8]) -> Option<String>` and `parse::text_body(bytes: &[u8]) -> Option<String>` (used by rendering)
  - `parse::attachment_bytes(bytes: &[u8], part_index: u32) -> Option<Vec<u8>>`

- [ ] **Step 1: Write failing tests:**
  - `gmail_headers`: `thrid == Some(42)`, labels `["Inbox","Category Promotions","Receipts 2019"]` from `Inbox,Category Promotions,"Receipts 2019"`.
  - `labels_with_quotes_and_unicode`: `"a,b",Família,Starred` → `["a,b","Família","Starred"]`.
  - `addresses_and_subject`: `Ana Pérez <ana@x.com>` → `Address{name:Some("Ana Pérez"), addr:"ana@x.com"}`; RFC 2047-encoded subject decoded.
  - `date_falls_back_to_from_line`: `no_date()` → `date == raw.from_line_date.unwrap()`; garbage `Date: yesterday-ish` → same.
  - `text_from_html_only`: html-only message → `body_text` contains the visible text, no tags; `snippet.len() <= 200`.
  - `attachments_listed`: one PDF + one inline cid image → 2 `AttachmentInfo` with filenames/mime/content_id; `attachment_bytes(.., idx)` returns the PDF bytes.
  - `charset_latin1`: ISO-8859-1 body decodes `ç`.
  - `parse_never_panics_on_garbage`: 1,000 random byte buffers (seeded) → each returns `Ok` or `Err`, never panics.
  - `content_key_ignores_gmail_headers`: same message with different `X-Gmail-Labels`/`X-GM-THRID` → equal `content_key`; different body → different.
  - `header_key_none_without_message_id`; `header_key_normalizes`: `<ABC@x>` vs `abc@x` with same Date/From → equal.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** with `mail-parser`. Header key = SHA-256 of `lowercase(message_id without <>)` + `\0` + `date` (unix secs) + `\0` + `lowercase(from.addr)`. Content key = SHA-256 of the bytes with `X-Gmail-Labels` and `X-GM-THRID` header lines (including folded continuation lines) removed. HTML→text: strip tags, decode entities, collapse whitespace.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): parse messages, gmail headers, dedupe keys`.

---

### Task 3: Message store and paths/permissions

**Files:**
- Create: `crates/core/src/store.rs`, `crates/core/src/paths.rs`
- Test: unit tests in each

**Interfaces:**
- Produces:
  - `store::Store::open(dir: &Path) -> Result<Store>`; `append(&mut self, bytes: &[u8]) -> Result<MessageRef>`; `read(&self, r: MessageRef) -> Result<Vec<u8>>`; `sync(&mut self) -> Result<()>`
  - `paths::default_library_dir() -> PathBuf`; `paths::cloud_sync_warning(p: &Path) -> Option<&'static str>`; `paths::create_private_dir(p: &Path) -> io::Result<()>` (0700); `paths::create_private_file(p: &Path) -> io::Result<File>` (0600)

- [ ] **Step 1: Write failing tests:**
  - `append_read_roundtrip`: 1,000 messages of varying size → each `read` equals input.
  - `rolls_to_new_pack`: with a test-only pack limit of 1 MB, writing 3 MB yields `pack_id` 0, 1, 2 and all still readable.
  - `reopen_appends_after_existing`: open, append, drop, reopen, append → both readable, offsets don't overlap.
  - `large_message`: a 30 MB message round-trips.
  - `files_are_private`: pack file mode `& 0o777 == 0o600`, dir `0o700`.
  - `cloud_paths_warned`: `~/Library/CloudStorage/Dropbox-x/a`, `~/Dropbox/a`, `~/Library/Mobile Documents/com~apple~CloudDocs/a`, `~/Google Drive/a`, `~/Library/CloudStorage/OneDrive-x/a` → `Some`; `~/Library/Application Support/mail-archive/library` → `None`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Packs `store/pack-00000.zst`…, rolled at 1 GiB (constructor-injectable for tests). Each record is one independent zstd frame (level 3); `MessageRef` points at the frame. On open, position at end of the last pack. Trailing partial frames from a crash are never referenced and are ignored.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): append-only zstd store and private paths`.

---

### Task 4: Event log

**Files:**
- Create: `crates/core/src/events.rs`
- Test: unit tests

**Interfaces:**
- Produces:
```rust
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub enum Event {
    ImportStarted   { import_id: u64, at: i64, source: String, kind: ImportKind },
    MessageAdded    { import_id: u64, content_key: Key, header_key: Option<Key>, msg_ref: MessageRef, labels: Vec<String> },
    LabelsChanged   { import_id: u64, content_key: Key, labels: Vec<String> },
    ImportCompleted { import_id: u64, at: i64, removed: Vec<Key> },   // removed = absent from this full import
}
pub struct EventLog;  // open(path) -> Result<EventLog>; append(&mut self, e: &Event) -> Result<()>; sync(&mut self) -> Result<()>
pub fn read_events(path: &Path) -> Result<Vec<Event>>;                    // ignores a torn final line
pub fn completed_events(all: Vec<Event>) -> Vec<Event>;                   // drops every event of imports lacking ImportCompleted
```
Keys serialize as lowercase hex strings.

- [ ] **Step 1: Write failing tests:** `roundtrip_all_variants`; `torn_last_line_ignored` (append garbage half-line → `read_events` returns the prior events); `incomplete_import_dropped` (import 1 complete, import 2 started + 2 adds, no completion → `completed_events` contains only import 1's events); `file_is_private` (0600).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** as newline-delimited JSON, append-only, `sync` = `fsync`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): append-only event log`.

---

### Task 5: SQLite metadata

**Files:**
- Create: `crates/core/src/meta.rs`
- Test: unit tests

**Interfaces:**
- Consumes: `ParsedMessage`, `DedupeKeys`, `MessageRef`
- Produces:
  - `meta::MetaDb::open(path: &Path) -> Result<MetaDb>` (WAL, schema created/migrated; `PRAGMA user_version` = schema version)
  - `MetaDb::insert_message(&self, p: &ParsedMessage, k: &DedupeKeys, r: MessageRef, import_id: u64) -> Result<MsgId>`
  - `MetaDb::set_labels(&self, id: MsgId, labels: &[String]) -> Result<()>`
  - `MetaDb::mark_seen(&self, import_id: u64, except_removed: &[MsgId]) -> Result<()>` (sets `last_seen_import` for all not-removed messages)
  - `MetaDb::key_index(&self) -> Result<KeyIndex>` where `KeyIndex { by_content: HashMap<Key, MsgId>, by_header: HashMap<Key, Vec<(MsgId, Option<u64>)>>, labels: HashMap<MsgId, Vec<String>> }`
  - `MetaDb::message(&self, id: MsgId) -> Result<MessageRow>`; `MetaDb::thread(&self, thrid: i64) -> Result<Vec<MessageRow>>` (oldest first; Gmail thread ids are stored as `i64`, synthetic ones are negative)
  - `MetaDb::top_labels(&self, prefix: &str, limit: usize) -> Result<Vec<String>>`; `MetaDb::top_addresses(&self, prefix: &str, limit: usize) -> Result<Vec<Address>>` (ranked by frequency)
  - `MetaDb::delete_import(&self, import_id: u64) -> Result<()>` (rows with `first_seen_import = import_id`)
  - `MetaDb::latest_message_date(&self) -> Result<Option<i64>>`; `MetaDb::count(&self) -> Result<u64>`; `MetaDb::transaction<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T>`
  - `MessageRow` = the spec §7.1 columns plus `labels: Vec<String>`, `attachments: Vec<AttachmentInfo>`, `removed: bool`.
  - Messages with no `thrid` get a synthetic negative thread id derived from `References`/`In-Reply-To` root, else `-(MsgId)`.

- [ ] **Step 1: Write failing tests:** `insert_and_fetch`; `thread_ordered_oldest_first`; `labels_replace`; `key_index_contains_both_keys`; `delete_import_removes_only_that_import`; `top_addresses_ranked_by_frequency` (3× bob, 1× bea → prefix `b` returns bob first); `removed_flag` (`mark_seen(2, &[id])` → that row `removed == true`, others false); `fallback_thread_from_references`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** with `rusqlite` (bundled). Tables per spec §7.1, plus `addresses(addr, name, count)` maintained on insert. `removed` = `last_seen_import < (SELECT max(id) FROM imports WHERE kind='Full' AND completed)`; store it as a column updated by `mark_seen` for speed.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): sqlite metadata`.

---

### Task 6: Search index

**Files:**
- Create: `crates/core/src/index.rs`
- Test: unit tests

**Interfaces:**
- Produces:
  - `index::SCHEMA_VERSION: u32 = 1` (bump whenever schema/tokenizers change)
  - `index::SearchIndex::open_or_create(dir: &Path) -> Result<OpenedIndex>` where `enum OpenedIndex { Ready(SearchIndex), NeedsRebuild(SearchIndex) }` (version mismatch → `NeedsRebuild`)
  - `SearchIndex::writer(&self) -> Result<IndexWriterHandle>`; `IndexWriterHandle::upsert(&mut self, d: &IndexDoc)`, `delete_import(import_id)`, `commit(&mut self) -> Result<()>`
  - `pub struct IndexDoc { msg_id, thrid: i64, import_id: u64, date: i64, size: u64, subject, body, from, to, cc, bcc: String, filenames: String, labels: Vec<String>, has_attachment: bool, removed: bool }`
  - `IndexDoc::from_parsed(id: MsgId, thrid: i64, import_id: u64, p: &ParsedMessage, removed: bool) -> IndexDoc`
  - `SearchIndex::fields(&self) -> &Fields` (used by query exec), `SearchIndex::searcher(&self) -> Searcher`

- [ ] **Step 1: Write failing tests:**
  - `accent_and_case_insensitive`: doc from `José Café <jose@x.com>`, subject "Café" → term queries `jose` on `from` and `cafe` on `subject` hit.
  - `address_tokenized`: `orders@amazon.com` → `amazon`, `orders`, `com` all hit `from`; `amazon.com` as a phrase hits.
  - `upsert_replaces`: upsert same `msg_id` twice with different labels → one doc, new labels.
  - `labels_exact_lowercased`: label `Receipts 2019` stored as one token `receipts 2019`.
  - `delete_import`; `schema_mismatch_needs_rebuild` (write version 0 marker → `NeedsRebuild`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Text tokenizer: simple + lowercase + ASCII folding, no stemming. Address tokenizer: split on non-alphanumeric (`@ . - _ +` etc.) + lowercase + ASCII folding. `labels`: raw tokenizer on lowercased label. Fast fields: `msg_id`, `thrid`, `import_id`, `date`, `size`, `has_attachment`, `removed`. Store only `msg_id`. Version marker file `index/VERSION`. Writer memory budget 256 MB.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): tantivy index`.

---

### Task 7: Query parser

**Files:**
- Create: `crates/core/src/query/{mod.rs,parse.rs}`
- Test: table-driven tests in `parse.rs`

**Interfaces:**
- Produces:
```rust
pub enum Expr { And(Vec<Expr>), Or(Vec<Expr>), Not(Box<Expr>), Term(Term) }
pub enum Term {
    Text(String), Phrase(String),
    From(String), To(String), Cc(String), Bcc(String), Subject(String),
    Label(String), Category(String), In(Location), Is(Flag), HasAttachment, Filename(String),
    After(NaiveDate), Before(NaiveDate), OlderThan(Age), NewerThan(Age), Larger(u64), Smaller(u64),
}
pub enum Location { Inbox, Sent, Spam, Trash, Anywhere }
pub enum Flag { Starred, Important, Unread, Removed }
pub struct Age { pub n: u32, pub unit: AgeUnit }  pub enum AgeUnit { Day, Month, Year }
#[derive(Serialize)] pub struct Chip { pub start: usize, pub end: usize, pub label: String }  // byte span in input; label e.g. "from: delta"
#[derive(Serialize)] pub struct Hint { pub start: usize, pub end: usize, pub message: String }
pub struct ParsedQuery { pub expr: Option<Expr>, pub chips: Vec<Chip>, pub hints: Vec<Hint>, pub terms: Vec<String> } // terms = words/phrases to highlight
pub fn parse_query(input: &str) -> ParsedQuery;
```

- [ ] **Step 1: Write failing table-driven tests** covering every row of spec §9, including:
  - `from:delta after:2018/01/01 has:attachment` → `And[From("delta"), After(2018-01-01), HasAttachment]`, 3 chips with spans covering each operator token.
  - `"exact phrase" -word`, `a OR b`, `{a b}`, `(a OR b) c`, `-from:x`, `label:"Receipts 2019"`, `label:receipts-2019` (→ `Label("receipts 2019")`), `after:2018-01-01`, `older_than:2y`, `larger:5M` (→ 5_242_880), `smaller:200K`, `is:removed`, `in:anywhere`, `category:promotions`, `filename:pdf`, `FROM:Bob` (case-insensitive operator).
  - `unknown_operator_is_text`: `foo:bar` → `Text("foo:bar")`.
  - `invalid_date_hint`: `after:2018/13/45` → no `After` term, one `Hint` with the span.
  - `partial_queries_never_fail`: each of `from:`, `"unclosed`, `(a b`, `a -`, `a OR`, `)`, `-`, `""`, `   ` returns without panic; `expr` is `None` or plain text terms.
  - `terms_for_highlight`: `from:x hello "big deal"` → `terms == ["hello", "big deal"]`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** a hand-written tokenizer + recursive-descent parser (precedence: `-` > implicit AND > `OR`). Chips are emitted for operator terms only (not plain words).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): gmail query parser`.

---

### Task 8: Query execution and the Library facade (read side)

**Files:**
- Create: `crates/core/src/query/exec.rs`, `crates/core/src/library.rs`
- Test: `crates/core/tests/search.rs` (builds a library from fixtures via a test helper that inserts directly through store/meta/index)

**Interfaces:**
- Consumes: Tasks 3–7
- Produces:
  - `library::Library::open(dir: &Path) -> Result<Library>` — creates dirs if missing; rolls back an incomplete import (Task 10 hooks in); exposes `needs_rebuild(&self) -> bool`
  - `Library::search(&self, q: &str, offset: usize, limit: usize, now: i64, tz_offset_secs: i32) -> Result<SearchResults>`
  - `#[derive(Serialize)] pub struct SearchResults { pub threads: Vec<ThreadHit>, pub total_messages: usize, pub elapsed_ms: f64, pub chips: Vec<Chip>, pub hints: Vec<Hint>, pub terms: Vec<String> }`
  - `#[derive(Serialize)] pub struct ThreadHit { pub thrid: i64, pub latest_date: i64, pub senders: Vec<String>, pub message_count: u32, pub subject: String, pub snippet: String, pub has_attachment: bool, pub matched: Vec<MsgId> }`
  - `Library::thread(&self, thrid: i64) -> Result<Vec<MessageRow>>`; `Library::raw(&self, id: MsgId) -> Result<Vec<u8>>`
  - `Library::autocomplete(&self, kind: SuggestKind, prefix: &str) -> Result<Vec<String>>` (`SuggestKind::{Label, Address}`, limit 10)

- [ ] **Step 1: Write failing tests** against a ~30-message fixture library:
  - `operators_filter`: one test per operator from §9 asserting the exact set of matched thread ids.
  - `spam_trash_excluded_by_default`: a Spam-labelled match is absent; present with `in:spam` and `in:anywhere`.
  - `before_is_exclusive`: message at local `2020-01-01 00:30` excluded by `before:2020/01/01`, included by `after:2019/12/31`.
  - `grouped_by_thread_newest_first`: 3 matching messages in one thread → one `ThreadHit`, `message_count` = thread size, `matched.len() == 3`, ordered by `latest_date` desc.
  - `empty_query_recent_mail`: `""` → newest threads, Spam/Trash excluded.
  - `paging`: `offset`/`limit` return disjoint consecutive pages.
  - `autocomplete_labels_and_addresses`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Map `Expr` to a Tantivy `BooleanQuery`: `Text` → should-across subject/body/from/to/cc/filenames (AND between words); `Phrase` → `PhraseQuery` on subject + body; dates/sizes → range queries on fast fields (date bounds computed in local time from `tz_offset_secs`); `Is(Starred|Important|Unread)` and `In(Inbox|Sent|Spam|Trash)` → the lowercased Gmail label of the same name; `Is(Removed)` → `removed` fast field; `Category(x)` → label `category x`; default filter excludes labels `spam`/`trash` unless an `In(Spam|Trash|Anywhere)` term is present. Collect top 5,000 matching messages by `date` desc (fast-field ordered), group by `thrid` preserving order, then page threads. `total_messages` from a `Count` collector.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): query execution and library read API`.

---

### Task 9: Import sources and scan

**Files:**
- Create: `crates/core/src/import/{mod.rs,source.rs,scan.rs}`
- Test: `crates/core/tests/import_scan.rs`

**Interfaces:**
- Consumes: `MboxReader`, `parse_message`, `dedupe_keys`, `MetaDb::key_index`, `MetaDb::latest_message_date`
- Produces:
  - `source::open_source(paths: &[PathBuf]) -> Result<Source>`; `Source { pub kind: ImportKind, pub label: String, pub reader: Box<dyn BufRead + Send> }`. Searches each zip for an entry ending `.mbox`; `Full` iff the entry's file name is exactly `All mail Including Spam and Trash.mbox`; a bare `.mbox` path is opened directly with the same rule.
  - `scan::scan(lib: &Library, paths: &[PathBuf], progress: &dyn Fn(Progress), cancel: &AtomicBool) -> Result<ScanReport>`
  - `#[derive(Serialize)] pub struct Progress { pub phase: &'static str, pub processed: u64, pub bytes: u64, pub total_bytes: Option<u64>, pub rate_per_sec: f64 }`
  - `#[derive(Serialize)] pub struct ScanReport { pub kind: ImportKind, pub source_label: String, pub total: u64, pub new: u64, pub label_changes: u64, pub unchanged: u64, pub removed: u64, pub removed_fraction: f64, pub matched_by_content: u64, pub matched_by_header: u64, pub parse_errors: u64, pub looks_older: bool, #[serde(skip)] pub plan: ImportPlan }`
  - `pub struct ImportPlan { pub decisions: Vec<Decision>, pub removed: Vec<MsgId>, pub source_paths: Vec<PathBuf> }`; `pub enum Decision { New, Relabel(MsgId), Unchanged, Skip }` — one per message position in the source.

- [ ] **Step 1: Write failing tests** (fixture zips/mboxes written to a temp dir):
  - `streams_from_zip`: zip containing `Takeout/Mail/All mail Including Spam and Trash.mbox` → `kind == Full`; other `.mbox` name → `Partial`.
  - `first_scan_all_new`.
  - `rescan_detects_changes`: after importing A (use Task 10 once available; until then insert via the Task 8 test helper), scan A′ with +2 new, 1 relabelled, 1 missing → `new == 2, label_changes == 1, removed == 1, unchanged == rest`.
  - `refolded_headers_match_by_header`: same message with re-folded `Subject` → `matched_by_header == 1`, not new.
  - `colliding_message_ids_both_new`: two different messages with the same Message-ID and different `thrid` → both `New`.
  - `partial_never_relabels_or_removes`: Partial source with relabelled message → `Unchanged`, `removed == 0`.
  - `older_export_flagged`: newest message older than library's newest → `looks_older == true`, and plan contains no `Relabel` and `removed` empty.
  - `scan_counts_parse_errors_and_continues`: mbox with a garbage message in the middle → `parse_errors == 1`, others counted.
  - `cancel_stops_scan`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Match order: content key → hit; else header key → hit only if the candidate's `thrid` equals this message's `thrid` (or either is `None`); else `New`. Parse in parallel with `rayon` over batches of ~2,000 raw messages read sequentially. `removed` (Full, not `looks_older`) = library ids not matched by any source message and not already removed.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): import sources and scan/diff`.

---

### Task 10: Import apply and crash safety

**Files:**
- Create: `crates/core/src/import/apply.rs`
- Modify: `crates/core/src/library.rs` (rollback on open)
- Test: `crates/core/tests/import_apply.rs`

**Interfaces:**
- Consumes: `ScanReport.plan`, `Store`, `EventLog`, `MetaDb`, `IndexWriterHandle`
- Produces:
  - `apply::apply(lib: &mut Library, report: &ScanReport, progress: &dyn Fn(Progress), cancel: &AtomicBool) -> Result<ImportSummary>`
  - `#[derive(Serialize)] pub struct ImportSummary { pub import_id: u64, pub added: u64, pub relabelled: u64, pub removed_marked: u64, pub parse_errors: u64, pub elapsed_secs: f64 }`
  - `Library::import(&mut self, paths, progress, cancel)` convenience = `scan` + `apply` (CLI/tests).

- [ ] **Step 1: Write failing tests:**
  - `import_then_search`: import fixture zip → `search("from:ana")` finds expected thread.
  - `reimport_is_idempotent`: import A twice → count unchanged, second summary `added == 0`.
  - `diff_import_end_to_end`: A then A′ → labels updated in SQLite and search (`label:newlabel`), `is:removed` finds the missing one, the missing message still opens via `thread()`.
  - `cancel_rolls_back`: cancel mid-apply → on reopen `count()` equals pre-import count, search returns no docs from the cancelled import, event log has no completed events for it.
  - `crash_rolls_back`: simulate by applying with a test hook that returns `Err` after N messages, drop library without cleanup, reopen → same as above; then a fresh import succeeds.
  - `source_changed_between_scan_and_apply`: different message count on second pass → error, nothing applied.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Order: `ImportStarted` → stream source again, for each `New` append to store, `MessageAdded` event, insert into SQLite, upsert index doc; commit SQLite + index + `sync` store/log every 5,000 messages. Then in one final step: apply `Relabel`s (`LabelsChanged` events, `set_labels`, re-index from stored bytes), `mark_seen`, re-index removed docs with `removed = true`, append `ImportCompleted`, sync, commit. On `Library::open`: if the log's last import has no `ImportCompleted`, call `MetaDb::delete_import` and `IndexWriterHandle::delete_import` for it, then append nothing (the incomplete events are ignored by `completed_events`). Next import id = max seen + 1.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): apply imports with rollback on crash/cancel`.

---

### Task 11: Rebuild from store + event log

**Files:**
- Create: `crates/core/src/rebuild.rs`
- Test: `crates/core/tests/rebuild.rs`

**Interfaces:**
- Produces: `rebuild::rebuild(lib_dir: &Path, progress: &dyn Fn(Progress), cancel: &AtomicBool) -> Result<()>`; `Library::rebuild(&mut self, ..)` wrapper that reopens afterwards.

- [ ] **Step 1: Write failing tests:**
  - `rebuild_reproduces_state`: import A then A′, snapshot (`count`, every row's labels + `removed`, results of 10 queries); delete `meta.sqlite` and `index/`; rebuild; snapshot equal.
  - `rebuild_after_schema_bump`: write an old `index/VERSION` → `Library::open` reports `needs_rebuild()`; after rebuild it is false.
  - `rebuild_cancel_keeps_old`: cancel midway → old SQLite/index still in place and usable.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Build into `meta.sqlite.rebuild` and `index.rebuild/`, replaying `completed_events(read_events(..))` in order (re-reading and re-parsing bytes from `MessageRef`s), then atomically rename over the old ones.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): rebuild library from store and event log`.

---

### Task 12: CLI and the real-data checkpoint

**Files:**
- Create: `crates/cli/Cargo.toml`, `crates/cli/src/main.rs`
- Test: `crates/cli/tests/cli.rs` (runs the binary against a fixture zip in a temp dir)

**Interfaces:**
- Produces: `mail-cli --library <dir> import <zip-or-mbox>...` (prints `ScanReport`, asks `y/N` unless `--yes`), `search "<query>" [--limit N]` (prints date · sender · subject · count), `rebuild`, `bench` (runs a fixed list of 20 representative queries 5× each, prints p50/p95 ms).

- [ ] **Step 1: Write failing test** `cli_import_and_search`: import fixture with `--yes`, `search "from:ana"` stdout contains the fixture subject.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** with `clap`; progress on stderr as a single updating line; library default = `paths::default_library_dir()`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Real-data checkpoint (manual, not committed):**
  - `cargo run --release -p mail-cli -- import "<takeout folder>/takeout-*.zip"` → record total time (target < 30 min), message count, parse error count, library size on disk.
  - `cargo run --release -p mail-cli -- bench` → p95 < 100 ms. If not, profile before building the UI.
  - Write the numbers into `docs/benchmarks.md` (numbers only, no message content).
- [ ] **Step 6: Commit** `feat(cli): import/search/rebuild/bench` (+ `docs/benchmarks.md`).

---

### Task 13: Safe HTML rendering

**Files:**
- Create: `crates/core/src/render.rs`
- Test: unit tests

**Interfaces:**
- Produces:
  - `render::render_body(raw: &[u8], msg_id: MsgId, terms: &[String]) -> RenderedBody` where `pub struct RenderedBody { pub html: String, pub blocked_remote: u32 }` — full HTML document for the iframe; plain-text messages are escaped, linkified, wrapped in `<pre>`-like styled HTML.
  - Inline images rewritten to `mailcid://localhost/{msg_id}/{url-encoded cid}`.
  - `render::BODY_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src mailcid: data:; font-src data:"`

- [ ] **Step 1: Write failing tests:**
  - `strips_active_content`: `<script>`, `onclick=`, `<iframe>`, `<object>`, `<form>`, `<meta http-equiv=refresh>`, `<link rel=stylesheet>`, `@import`, `javascript:` hrefs → none present in output.
  - `no_remote_references`: input with `<img src=https://t.co/p.gif>`, `background=http://…`, `style="background:url(http://…)"`, `<img srcset=…>`, `<video poster=…>` → output matches no `(?i)(src|srcset|background|poster)\s*=\s*["']?(https?:)?//` and no `url\(\s*["']?(https?:)?//`; `blocked_remote == 5`; a placeholder element exists for each blocked image.
  - `cid_rewritten`: `<img src="cid:logo@x">` → `mailcid://localhost/7/logo%40x`.
  - `links_kept_for_click`: `<a href="https://example.com">` keeps its href and gets `target="_blank" rel="noopener noreferrer"` (the app intercepts the new-window request, Task 16).
  - `highlights_terms`: terms `["delta"]` wrap text-node matches in `<mark>`, not inside attributes or tags.
  - `huge_html_ok`: a 5 MB HTML body renders in < 500 ms (release) / no panic.
  - `plain_text_escaped_and_linkified`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**: `ammonia` sanitize (allow inline `style`, tables, images) → `lol_html` pass to rewrite/strip remote `src`/`srcset`/`background`/`poster`, remote `url()` inside `style` attributes and `<style>` blocks, `cid:` URLs, and highlight terms in text chunks. Wrap in a document with a `<meta http-equiv="Content-Security-Policy" content=BODY_CSP>`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(core): sanitize and render message bodies`.

---

### Task 14: Tauri shell, IPC, and network lockdown

**Files:**
- Create: `app/` via `pnpm create tauri-app` (Svelte + TypeScript template), then trim: `app/src-tauri/src/{main.rs,commands.rs,protocol.rs,config.rs}`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/capabilities/default.json`
- Test: `app/src-tauri/tests/lockdown.rs`, unit tests in `config.rs`

**Interfaces:**
- Consumes: `Library` (wrapped in `Mutex` in Tauri state; scan/apply/rebuild run on a blocking thread)
- Produces (Tauri commands, camelCase in TS):
  - `search(q: String, offset: u32, limit: u32) -> SearchResults`
  - `get_thread(thrid: i64, terms: Vec<String>) -> Vec<MessageView>` where `MessageView { id, from: Address, to, cc: Vec<Address>, date: i64, labels: Vec<String>, subject: String, attachments: Vec<AttachmentInfo>, body_url: String /* mailbody://localhost/{id}?t=<terms> */, blocked_remote: u32 }`
  - `autocomplete(kind: String /* "label"|"address" */, prefix: String) -> Vec<String>`
  - `open_attachment(msg_id: i64, part: u32)` (temp copy in app cache dir → `open` it; cache cleared on exit); `save_attachment(msg_id: i64, part: u32, dest: String)`
  - `open_link(url: String)` (only `http`, `https`, `mailto`; via `/usr/bin/open`)
  - `import_scan(paths: Vec<String>) -> ScanReport`, `import_apply() -> ImportSummary`, `import_cancel()`, `rebuild_index()`; progress emitted as event `"progress"` with `Progress`
  - `library_status() -> LibraryStatus { path: String, configured: bool, message_count: u64, needs_rebuild: bool }`; `set_library_path(path: String) -> Option<String>` (returns `cloud_sync_warning` text)
  - Custom protocols: `mailbody://` (serves `render_body` output with header `Content-Security-Policy: BODY_CSP`), `mailcid://` (serves inline part bytes for `{msg_id}/{cid}`).
  - `config.rs`: `Config { library_path: Option<PathBuf> }` stored at `~/Library/Application Support/mail-archive/config.json`.

- [ ] **Step 1: Write failing tests:**
  - `lockdown.rs::app_csp_has_no_remote`: parse `tauri.conf.json` → `app.security.csp` exists; contains `default-src 'self'`; contains no `http:`, `https:`, `ws:`, `*`.
  - `lockdown.rs::no_network_plugins`: `Cargo.toml` of the app has no `tauri-plugin-updater`, `tauri-plugin-http`, `tauri-plugin-websocket`, `reqwest`, `ureq`, `hyper` dependency (scan `cargo metadata` resolve graph for these crate names).
  - `config::roundtrip_and_default`.
  - `commands::open_link_rejects_other_schemes`: `file:///etc/passwd`, `javascript:x` → `Err`.
- [ ] **Step 2:** run `cargo test -p mail-archive-app` → FAIL.
- [ ] **Step 3: Implement.** CSP: `default-src 'self'; img-src 'self' mailcid: data:; style-src 'self' 'unsafe-inline'; frame-src mailbody:; connect-src ipc: http://ipc.localhost`. Capabilities: only `core:event`, `core:window` defaults and `dialog` (open/save for import + Save As). Disable the updater in config. Bundle all fonts/assets locally. Window title "Mail Archive", default size 1280×800.
- [ ] **Step 4:** run → PASS; `pnpm tauri dev` launches an empty window.
- [ ] **Step 5: Commit** `feat(app): tauri shell, ipc commands, network lockdown`.

---

### Task 15: Search box, chips, autocomplete

**Files:**
- Create: `app/src/lib/api.ts`, `app/src/lib/chips.ts`, `app/src/components/SearchBox.svelte`, `app/src/components/ChipRow.svelte`, `app/src/App.svelte` (layout skeleton)
- Test: `app/src/lib/chips.test.ts` (Vitest)

**Interfaces:**
- Consumes: `search`, `autocomplete` commands; `Chip` spans from `SearchResults.chips`
- Produces:
  - `chips.ts`: `removeSpan(query: string, start: number, end: number): string` (removes the span plus one adjacent space, never leaves double spaces); `insertOperator(query: string, op: string): string` (appends with single space; quotes values containing spaces); `currentToken(query: string, caret: number): { operator: 'label' | 'from' | 'to' | null, prefix: string, start: number, end: number }`. Spans from Rust are **byte** offsets — convert with `TextEncoder` (helper `byteToCharIndex(query, byteIdx)`).
  - `api.ts`: typed wrappers for every Task 14 command.
  - Store `query` (Svelte `$state`) shared by components.

- [ ] **Step 1: Write failing Vitest tests:** `removeSpan` middle/start/end of query; multi-byte (`from:josé after:2020/01/01` remove second chip); `insertOperator('a', 'label:Receipts 2019')` → `a label:"Receipts 2019"`; `currentToken('x from:an', 9)` → `{operator:'from', prefix:'an'}`.
- [ ] **Step 2:** `pnpm vitest run` → FAIL.
- [ ] **Step 3: Implement.** SearchBox: large, autofocused, placeholder `Search mail — try from:, after:, has:attachment, label:`; debounced 100 ms; each request carries a sequence number and responses older than the latest are dropped. ChipRow renders `chips` with ✕ (→ `removeSpan`), plus **+ label** (dropdown of `autocomplete('label','')`) and **+ date** (two native `<input type=date>` → `after:`/`before:`). Autocomplete dropdown under the caret for `label:`/`from:`/`to:`; Tab/Enter accepts. Show `hints` as a subtle line under the chips. App CSS defines colors as variables and follows the system light/dark setting via `prefers-color-scheme`; all fonts are system fonts (no remote or bundled web fonts needed).
- [ ] **Step 4:** run → PASS; manual: typing in `pnpm tauri dev` updates chips live.
- [ ] **Step 5: Commit** `feat(ui): search box, chips, autocomplete`.

---

### Task 16: Results list, reading pane, keyboard

**Files:**
- Create: `app/src/components/ResultsList.svelte`, `app/src/components/ReadingPane.svelte`, `app/src/lib/keys.ts`
- Test: `app/src/lib/keys.test.ts`

**Interfaces:**
- Consumes: `search`, `get_thread`, `open_attachment`, `save_attachment`, `open_link`
- Produces: `keys.ts`: `handleKey(e: { key: string, metaKey: boolean, target: 'search' | 'list' | 'pane' }, state: { selected: number, count: number, query: string }): Action` where `Action` = `{type:'focusSearch'} | {type:'select', index:number} | {type:'focusPane'} | {type:'clear'} | {type:'focusList'} | {type:'copy'} | {type:'none'}`.

- [ ] **Step 1: Write failing Vitest tests** for `handleKey`: `⌘F` and `/` (outside search) → `focusSearch`; `ArrowDown` at last index stays; `Enter`/`ArrowRight` in list → `focusPane`; `Escape` in search with text → `clear`, in pane → `focusList`; `⌘C` in list → `copy`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
  - ResultsList (~40% width): fixed row height, windowed rendering (only visible rows ± 10 in the DOM), loads the next page (`limit` 200) when within 50 rows of the end. Row: senders (+ `(n)` when `message_count > 1`), subject, snippet (muted), 📎, date (today → time, this year → `Mon D`, else `M/D/YY`). Highlight `terms` in subject/snippet. Header line: `{total_messages} messages · {elapsed_ms} ms`.
  - ReadingPane (~60%): messages oldest→newest; those in `matched` expanded, others collapsed to a one-line header (click to expand). Header shows from, to, cc, local date/time, labels as small tags. Body in `<iframe sandbox="allow-popups" src={body_url}>` (no scripts, no same-origin, no forms) sized from the `mailbody://` response (Rust adds the content height as a response header the pane reads via a second lightweight `get_body_height` call, or a fixed max-height with internal scroll — builder's choice). Links carry `target="_blank"` (Task 13); intercept the new-window request in Rust (Tauri 2 webview new-window/navigation handler), deny the window, and route the URL to `open_link` — the app window and the iframe never navigate. Verify manually that clicking a link opens the default browser and nothing else happens; if the new-window hook doesn't fire for sandboxed iframes, fall back to an `on_navigation` handler that cancels any non-`mailbody:` navigation and opens it in the browser. If `blocked_remote > 0`, show a small muted note "N remote images blocked".
  - Attachments as chips: click → `open_attachment`; context menu / secondary button → Save As (dialog) → `save_attachment`.
  - Selection follows ↑/↓ immediately; prefetch the thread for the next row.
  - `⌘C` copies `subject — sender — date`.
- [ ] **Step 4:** run → PASS; manual against the real library: ↑/↓ through 50 results feels instant; a newsletter with remote images shows placeholders and zero outbound connections (check with `nettop -p <pid>` or Little Snitch while browsing).
- [ ] **Step 5: Commit** `feat(ui): results list, reading pane, keyboard`.

---

### Task 17: First run, import flow, rebuild, menus

**Files:**
- Create: `app/src/components/FirstRun.svelte`, `app/src/components/ImportDialog.svelte`
- Modify: `app/src-tauri/src/main.rs` (menu), `app/src/App.svelte`

**Interfaces:**
- Consumes: `library_status`, `set_library_path`, `import_scan`, `import_apply`, `import_cancel`, `rebuild_index`, `"progress"` event

- [ ] **Step 1: Write failing test** (Rust, `commands`): `set_library_path_warns_for_dropbox` returns `Some(..)` for a `~/Library/CloudStorage/Dropbox-*/…` path and persists the choice in config.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
  - FirstRun (when `!configured`): shows default library path, "Choose another…" (folder dialog; show warning text if returned), then "Import Takeout…".
  - ImportDialog: file dialog (multi-select `.zip`/`.mbox`) → scanning progress (processed, rate, ETA, Cancel) → summary exactly in the form `412,330 already in library · 3,812 new · 1,140 label changes · 96 no longer in Gmail (kept)` plus `parse_errors` if > 0. Prominent warning when `removed_fraction > 0.05` or `looks_older` (with the spec's wording: older export → "adds new mail only"). Buttons Import / Cancel → apply progress → done summary.
  - If `needs_rebuild` on launch: banner "Search index needs rebuilding" + button.
  - App menu: **Import Takeout…** (⌘I), **Rebuild Index**, **Show Library in Finder**; standard Edit menu for copy/paste.
- [ ] **Step 4:** run → PASS; manual: fresh config → first-run flow → import a fixture zip → search works.
- [ ] **Step 5: Commit** `feat(ui): first run, import flow, rebuild, menus`.

---

### Task 18: Release build and acceptance on the real archive

**Files:**
- Modify: `docs/benchmarks.md`, `README.md`

- [ ] **Step 1:** `pnpm tauri build` → `.app` in `app/src-tauri/target/release/bundle/macos/`. Unsigned is fine.
- [ ] **Step 2: Acceptance run** (fresh library, real Takeout zips) and record in `docs/benchmarks.md`:
  - First import < 30 min; library size; parse errors.
  - Cold launch to typed query < 1 s; query p95 < 100 ms (`mail-cli bench` + spot checks in UI); open conversation < 50 ms; memory < 500 MB after 10 minutes of browsing (Activity Monitor).
  - Re-import the same Takeout → summary shows 0 new, 0 label changes, 0 removed.
  - With `nettop`/Little Snitch watching: launch, search, open 20 HTML-heavy emails (newsletters, receipts) → **zero** outbound connections.
  - `Rebuild Index` from the menu completes and search results are unchanged for the bench queries.
- [ ] **Step 3:** Fix any target misses (each as its own commit with a before/after number).
- [ ] **Step 4:** README: how to build, import, where the library lives, query syntax table (copy of spec §9).
- [ ] **Step 5: Commit** `docs: acceptance results and usage`.
