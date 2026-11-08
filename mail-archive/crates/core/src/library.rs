//! The `Library` facade: one directory holding the message store, event log,
//! SQLite metadata and search index. Read side: search, thread, raw, autocomplete.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::events::EventLog;
use crate::index::{OpenedIndex, SearchIndex};
use crate::meta::{MessageRow, MetaDb};
use crate::model::MsgId;
use crate::paths::{create_private_dir, create_private_file};
use crate::query::exec::{self, thread_hit};
use crate::query::parse_query;
use crate::store::Store;
use crate::{Error, Result};

pub use crate::query::exec::{SearchResults, ThreadHit};

const AUTOCOMPLETE_LIMIT: usize = 10;

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
        let store = Store::open(dir)?;
        let events = EventLog::open(&dir.join("events.log"))?;
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
        };
        lib.recover_incomplete_import()?;
        Ok(lib)
    }

    /// Hook for rolling back an import that never completed (Task 10).
    fn recover_incomplete_import(&mut self) -> Result<()> {
        Ok(())
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

    /// True when the index was recreated (schema change or unusable) or its
    /// document count disagrees with SQLite's message count.
    pub fn needs_rebuild(&self) -> bool {
        if self.index_was_rebuilt {
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
