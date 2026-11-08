//! The `Library` facade: one directory holding the message store, event log,
//! SQLite metadata and search index. Read side: search, thread, raw, autocomplete.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use crate::events::{EventLog, import_states};
use crate::import::apply::{self, ImportSummary};
use crate::import::scan::{self, Progress};
use crate::index::{OpenedIndex, SearchIndex};
use crate::meta::{MessageRow, MetaDb};
use crate::model::MsgId;
use crate::paths::{create_private_dir, create_private_file};
use crate::query::exec::{self, thread_hit};
use crate::query::parse_query;
use crate::rebuild::RebuildSummary;
use crate::store::Store;
use crate::{Error, Result};

pub use crate::query::exec::{SearchResults, ThreadHit};

const AUTOCOMPLETE_LIMIT: usize = 10;
/// Marker file: SQLite/index may disagree with the store + event log and
/// must be rebuilt from them. Cleared only by a rebuild.
pub(crate) const NEEDS_REBUILD_FILE: &str = "NEEDS_REBUILD";
const EVENTS_FILE: &str = "events.log";

/// Disjoint borrows of the library's parts, for the importer.
pub(crate) struct Parts<'a> {
    pub store: &'a mut Store,
    pub events: &'a mut EventLog,
    pub meta: &'a MetaDb,
    pub index: &'a SearchIndex,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SuggestKind {
    Label,
    Address,
}

pub struct Library {
    dir: PathBuf,
    // Held for the Library's lifetime; the advisory lock is released on drop.
    _lock: File,
    store: Store,
    events: EventLog,
    meta: MetaDb,
    index: SearchIndex,
    index_was_rebuilt: bool,
    /// Highest import id seen in the log or SQLite; ids are never reused.
    max_import_id: Option<u64>,
}

impl Library {
    /// Open (creating if missing) the library in `dir`, taking an exclusive
    /// advisory lock on `<dir>/LOCK`.
    pub fn open(dir: &Path) -> Result<Library> {
        create_private_dir(dir)?;
        let lock = create_private_file(&dir.join("LOCK"))?;
        lock.try_lock().map_err(|e| match e {
            std::fs::TryLockError::WouldBlock => Error::LibraryInUse,
            std::fs::TryLockError::Error(e) => Error::Io(e),
        })?;
        crate::rebuild::recover_swap(dir)?;
        let store = Store::open(dir)?;
        let events = EventLog::open(&dir.join(EVENTS_FILE))?;
        let meta = MetaDb::open(&dir.join("meta.sqlite"))?;
        let (index, index_was_rebuilt) = match SearchIndex::open_or_create(&dir.join("index"))? {
            OpenedIndex::Ready(i) => (i, false),
            OpenedIndex::NeedsRebuild(i) => (i, true),
        };
        let mut lib = Library {
            dir: dir.to_path_buf(),
            _lock: lock,
            store,
            events,
            meta,
            index,
            index_was_rebuilt,
            max_import_id: None,
        };
        lib.recover_incomplete_import()?;
        Ok(lib)
    }

    /// Roll back (or finish) an import that a crash or cancel interrupted.
    fn recover_incomplete_import(&mut self) -> Result<()> {
        apply::recover(self)
    }

    /// Scan `paths` and apply the result (CLI/tests; the app shows the scan
    /// report and asks before applying).
    pub fn import(
        &mut self,
        paths: &[PathBuf],
        progress: &dyn Fn(Progress),
        cancel: &AtomicBool,
    ) -> Result<ImportSummary> {
        let report = scan::scan(self, paths, progress, cancel)?;
        apply::apply(self, &report, progress, cancel)
    }

    /// A fresh import id: one past the highest id in the whole event log
    /// (rolled-back and incomplete imports included) and in SQLite. The log is
    /// scanned once per session; later calls use the remembered maximum.
    pub(crate) fn next_import_id(&mut self) -> Result<u64> {
        let max = match self.max_import_id {
            Some(m) => m,
            None => {
                let log = import_states(&self.events_path())?
                    .keys()
                    .next_back()
                    .copied()
                    .unwrap_or(0);
                let db = self.meta.latest_import()?.map_or(0, |(id, _, _)| id);
                log.max(db)
            }
        };
        self.max_import_id = Some(max + 1);
        Ok(max + 1)
    }

    /// Rebuild SQLite and the search index from the store and event log,
    /// then reopen them. See [`crate::rebuild`]. On cancel or error the old
    /// ones stay live. Unreadable messages are skipped and counted in the
    /// summary.
    pub fn rebuild(
        &mut self,
        progress: &dyn Fn(Progress),
        cancel: &AtomicBool,
    ) -> Result<RebuildSummary> {
        let summary = crate::rebuild::build(&self.dir, &self.store, progress, cancel)?;
        // The live database must be complete in its own file before it moves.
        if let Err(e) = self.meta.checkpoint_truncate() {
            let _ = crate::rebuild::discard_rebuild_files(&self.dir);
            return Err(e);
        }
        // Point of no return: close our SQLite handle so its files can move.
        self.meta = MetaDb::placeholder()?;
        let swapped = crate::rebuild::swap(&self.dir);
        if let Err(e) = &swapped
            && crate::rebuild::old_files_exist(&self.dir)
        {
            // Even recovery failed. Opening `meta.sqlite` now could create an
            // empty one next to the good `*.old`; leave it to the next open.
            return Err(Error::Meta(format!(
                "rebuild swap failed ({}) and could not be undone; reopen the library",
                e
            )));
        }
        // New files on success, the old ones after a clean rollback.
        let reopened = self.reopen_caches();
        swapped?;
        reopened?;
        crate::rebuild::clear_needs_rebuild(&self.dir)?;
        self.max_import_id = None;
        Ok(summary)
    }

    fn reopen_caches(&mut self) -> Result<()> {
        self.meta = MetaDb::open(&self.dir.join("meta.sqlite"))?;
        let (index, rebuilt) = match SearchIndex::open_or_create(&self.dir.join("index"))? {
            OpenedIndex::Ready(i) => (i, false),
            OpenedIndex::NeedsRebuild(i) => (i, true),
        };
        self.index = index;
        self.index_was_rebuilt = rebuilt;
        Ok(())
    }

    pub(crate) fn events_path(&self) -> PathBuf {
        self.dir.join(EVENTS_FILE)
    }

    pub(crate) fn parts(&mut self) -> Parts<'_> {
        Parts {
            store: &mut self.store,
            events: &mut self.events,
            meta: &self.meta,
            index: &self.index,
        }
    }

    /// Persistently flag that SQLite and the index must be rebuilt.
    pub(crate) fn mark_needs_rebuild(&self) -> Result<()> {
        create_private_file(&self.dir.join(NEEDS_REBUILD_FILE))?.sync_all()?;
        File::open(&self.dir)?.sync_all()?;
        Ok(())
    }

    /// Number of messages in the library.
    pub fn count(&self) -> Result<u64> {
        self.meta.count()
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    #[allow(dead_code)] // used by the import and rebuild tasks
    pub(crate) fn store(&self) -> &Store {
        &self.store
    }

    #[allow(dead_code)]
    pub(crate) fn events(&self) -> &EventLog {
        &self.events
    }

    #[allow(dead_code)]
    pub(crate) fn meta(&self) -> &MetaDb {
        &self.meta
    }

    #[allow(dead_code)]
    pub(crate) fn index(&self) -> &SearchIndex {
        &self.index
    }

    /// True when the index was recreated (schema change or unusable), its
    /// document count disagrees with SQLite's message count, or an interrupted
    /// import left SQLite/index changes that only a rebuild can undo.
    pub fn needs_rebuild(&self) -> bool {
        if self.index_was_rebuilt || self.dir.join(NEEDS_REBUILD_FILE).exists() {
            return true;
        }
        match self.meta.count() {
            Ok(n) => self.index.searcher().num_docs() != n,
            Err(_) => true,
        }
    }

    /// Run a Gmail-style query. `now` is unix seconds; `tz` is the time
    /// zone in which `after:`/`before:` day boundaries are resolved.
    pub fn search<Tz: chrono::TimeZone>(
        &self,
        q: &str,
        offset: usize,
        limit: usize,
        now: i64,
        tz: &Tz,
    ) -> Result<SearchResults> {
        let start = Instant::now();
        let parsed = parse_query(q);
        let query = exec::build_query(&self.index, parsed.expr.as_ref(), now, tz);
        let (hits, total_messages) = exec::run(&self.index, &*query)?;
        let page: Vec<_> = exec::group_threads(&hits)
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect();
        let thrids: Vec<i64> = page.iter().map(|g| g.thrid).collect();
        let summaries = self.meta.thread_summaries(&thrids)?;
        let threads = page
            .into_iter()
            .map(|g| {
                let msgs = summaries.get(&g.thrid).map(Vec::as_slice).unwrap_or(&[]);
                thread_hit(g, msgs)
            })
            .collect();
        Ok(SearchResults {
            threads,
            total_messages,
            elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
            chips: parsed.chips,
            hints: parsed.hints,
            terms: parsed.terms,
        })
    }

    /// All messages of a thread, oldest first.
    pub fn thread(&self, thrid: i64) -> Result<Vec<MessageRow>> {
        self.meta.thread(thrid)
    }

    /// One message's row (headers, labels, attachment list).
    pub fn message(&self, id: MsgId) -> Result<MessageRow> {
        self.meta.message(id)
    }

    /// The original RFC 822 bytes of a message.
    pub fn raw(&self, id: MsgId) -> Result<Vec<u8>> {
        let row = self.meta.message(id)?;
        self.store.read(row.msg_ref)
    }

    /// Up to 10 suggestions: label names, or `"Name <addr>"` / `addr`.
    pub fn autocomplete(&self, kind: SuggestKind, prefix: &str) -> Result<Vec<String>> {
        match kind {
            SuggestKind::Label => self.meta.top_labels(prefix, AUTOCOMPLETE_LIMIT),
            SuggestKind::Address => Ok(self
                .meta
                .top_addresses(prefix, AUTOCOMPLETE_LIMIT)?
                .into_iter()
                .map(|a| match a.name.filter(|n| !n.is_empty()) {
                    Some(n) => format!("{n} <{}>", a.addr),
                    None => a.addr,
                })
                .collect()),
        }
    }
}
