//! Rebuild `meta.sqlite` and `index/` from the store and the event log.
//!
//! The log's completed imports are replayed in order, producing what the same
//! sequence of real imports would have: `ImportStarted` recreates the
//! `imports` row, `MessageAdded` re-reads and re-parses the stored bytes and
//! inserts the row and index document (through the same helper the importer
//! uses), `LabelsChanged` relabels, and `ImportCompleted` of a Full import
//! applies `mark_seen` for the logged `removed` keys, re-indexes the touched
//! messages and marks the import `completed`. Imports that were rolled back or
//! never completed are skipped. Messages are read and parsed in batches capped
//! like import batches, and the log is streamed, never collected.
//!
//! Known limit: the `From ` line date of an mbox is not stored, so a message
//! without a usable `Date` header gets its date from the epoch fallback in
//! the parser rather than from its `From ` line.
//!
//! # Swap state machine
//!
//! The new state is built next to the live one as `meta.sqlite.rebuild`
//! (plus `-wal`/`-shm`) and `index.rebuild/`; the live files are not touched
//! until both are complete and durable, and a cancel or error simply deletes
//! the `*.rebuild` files. The swap then runs:
//!
//! 1. rename `meta.sqlite` -> `meta.sqlite.old`, `index` -> `index.old`
//! 2. rename `meta.sqlite.rebuild` -> `meta.sqlite`, `index.rebuild` -> `index`
//! 3. fsync the library directory
//! 4. delete `*.old`, then the `NEEDS_REBUILD` marker
//!
//! [`recover_swap`] runs on every `Library::open` (under the lock) and
//! resolves a crash at any point:
//! * no `*.old`: delete leftover `*.rebuild` (cancelled or crashed build);
//! * some `*.old` whose live twin is missing (crash in steps 1-2): roll back,
//!   i.e. delete any live twin that is the new one, rename every `*.old` back,
//!   delete `*.rebuild`;
//! * `*.old` present and every live file present (crash in steps 3-4): the
//!   swap completed; delete `*.old` and the marker.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rayon::prelude::*;

use crate::events::{Event, LogState, try_for_each_event};
use crate::import::apply::{insert_and_index, reindex};
use crate::import::scan::{Progress, install_panic_hook, parse_guarded};
use crate::import::{BATCH_BYTES, BATCH_MESSAGES};
use crate::index::{IndexWriterHandle, SearchIndex};
use crate::library::{Library, NEEDS_REBUILD_FILE};
use crate::meta::{ImportStatus, MetaDb};
use crate::model::{DedupeKeys, ImportKind, Key, MessageRef, MsgId, RawMessage};
use crate::store::Store;
use crate::{Error, Result};

const META: &str = "meta.sqlite";
const INDEX: &str = "index";
/// Added messages between index commits.
const COMMIT_EVERY: usize = 5_000;
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// Rebuild the library in `lib_dir` (opening it, and so taking its lock).
pub fn rebuild(lib_dir: &Path, progress: &dyn Fn(Progress), cancel: &AtomicBool) -> Result<()> {
    Library::open(lib_dir)?.rebuild(progress, cancel)
}

fn suffixed(dir: &Path, name: &str, suffix: &str) -> PathBuf {
    dir.join(format!("{name}{suffix}"))
}

/// `meta.sqlite<suffix>` and its WAL/shared-memory sidecars.
fn meta_files(dir: &Path, suffix: &str) -> [PathBuf; 3] {
    let base = suffixed(dir, META, suffix);
    let side = |s: &str| {
        let mut o: OsString = base.clone().into_os_string();
        o.push(s);
        PathBuf::from(o)
    };
    [base.clone(), side("-wal"), side("-shm")]
}

fn remove_any(p: &Path) -> Result<()> {
    let r = if p.is_dir() {
        fs::remove_dir_all(p)
    } else {
        fs::remove_file(p)
    };
    match r {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

fn rename_if_exists(from: &Path, to: &Path) -> Result<()> {
    match fs::rename(from, to) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

fn sync_dir(dir: &Path) -> Result<()> {
    File::open(dir)?.sync_all()?;
    Ok(())
}

fn remove_rebuild_files(dir: &Path) -> Result<()> {
    for p in meta_files(dir, ".rebuild") {
        remove_any(&p)?;
    }
    remove_any(&suffixed(dir, INDEX, ".rebuild"))
}

fn remove_old_files(dir: &Path) -> Result<()> {
    for p in meta_files(dir, ".old") {
        remove_any(&p)?;
    }
    remove_any(&suffixed(dir, INDEX, ".old"))
}

/// Resolve whatever an interrupted rebuild or swap left behind (see the
/// module docs). Call with the library lock held, before opening SQLite.
pub(crate) fn recover_swap(dir: &Path) -> Result<()> {
    let old_meta = suffixed(dir, META, ".old");
    let old_index = suffixed(dir, INDEX, ".old");
    let (meta_old, index_old) = (old_meta.exists(), old_index.exists());
    if !meta_old && !index_old {
        return remove_rebuild_files(dir);
    }
    let live_meta = dir.join(META);
    let live_index = dir.join(INDEX);
    let partial = (meta_old && !live_meta.exists()) || (index_old && !live_index.exists());
    if partial {
        if meta_old {
            for p in meta_files(dir, "") {
                remove_any(&p)?;
            }
            for (o, l) in meta_files(dir, ".old").iter().zip(meta_files(dir, "")) {
                rename_if_exists(o, &l)?;
            }
        }
        if index_old {
            remove_any(&live_index)?;
            fs::rename(&old_index, &live_index)?;
        }
        remove_rebuild_files(dir)?;
        sync_dir(dir)
    } else {
        remove_old_files(dir)?;
        remove_rebuild_files(dir)?;
        clear_needs_rebuild(dir)
    }
}

/// Delete the `NEEDS_REBUILD` marker (after a successful swap).
pub(crate) fn clear_needs_rebuild(dir: &Path) -> Result<()> {
    remove_any(&dir.join(NEEDS_REBUILD_FILE))?;
    sync_dir(dir)
}

/// Swap the finished `*.rebuild` files over the live ones. Nothing may have
/// `meta.sqlite` open. On error, rolls back to the old files.
pub(crate) fn swap(dir: &Path) -> Result<()> {
    let r = swap_steps(dir);
    if r.is_err() {
        let _ = recover_swap(dir);
    }
    r
}

fn swap_steps(dir: &Path) -> Result<()> {
    // Step 1: live -> old.
    for (l, o) in meta_files(dir, "").iter().zip(meta_files(dir, ".old")) {
        rename_if_exists(l, &o)?;
    }
    rename_if_exists(&dir.join(INDEX), &suffixed(dir, INDEX, ".old"))?;
    // Step 2: rebuild -> live.
    fs::rename(suffixed(dir, META, ".rebuild"), dir.join(META))?;
    fs::rename(suffixed(dir, INDEX, ".rebuild"), dir.join(INDEX))?;
    // Step 3, then 4 (the marker is cleared by the caller once reopened).
    sync_dir(dir)?;
    remove_old_files(dir)
}

struct Added {
    content_key: Key,
    header_key: Option<Key>,
    msg_ref: MessageRef,
    labels: Vec<String>,
}

struct Replay<'a> {
    meta: &'a MetaDb,
    store: &'a Store,
    writer: IndexWriterHandle,
    done: &'a HashSet<u64>,
    cancel: &'a AtomicBool,
    progress: &'a dyn Fn(Progress),
    total: u64,
    total_bytes: u64,
    started: Instant,
    last_emit: Instant,
    processed: u64,
    bytes: u64,
    ids: HashMap<Key, MsgId>,
    batch: Vec<Added>,
    batch_bytes: usize,
    since_commit: usize,
    import_id: u64,
    kind: ImportKind,
    touched: BTreeSet<MsgId>,
}

impl Replay<'_> {
    fn emit(&mut self, force: bool) {
        if force || self.last_emit.elapsed() >= PROGRESS_EVERY {
            self.last_emit = Instant::now();
            let secs = self.started.elapsed().as_secs_f64();
            (self.progress)(Progress {
                phase: "rebuild",
                processed: self.processed,
                bytes: self.bytes,
                total_bytes: Some(self.total_bytes),
                rate_per_sec: if secs > 0.0 {
                    self.processed as f64 / secs
                } else {
                    0.0
                },
            });
        }
    }

    fn on_event(&mut self, e: Event) -> Result<()> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(Error::Cancelled);
        }
        if !self.done.contains(&e.import_id()) {
            return Ok(());
        }
        match e {
            Event::ImportStarted {
                import_id,
                at,
                source,
                kind,
            } => {
                self.flush()?;
                self.meta.begin_import(import_id, at, &source, kind)?;
                self.kind = kind;
                self.import_id = import_id;
            }
            Event::MessageAdded {
                content_key,
                header_key,
                msg_ref,
                labels,
                ..
            } => {
                self.batch_bytes += msg_ref.length as usize;
                self.batch.push(Added {
                    content_key,
                    header_key,
                    msg_ref,
                    labels,
                });
                if self.batch.len() >= BATCH_MESSAGES || self.batch_bytes >= BATCH_BYTES {
                    self.flush()?;
                }
            }
            Event::LabelsChanged {
                content_key,
                labels,
                ..
            } => {
                self.flush()?;
                let id = *self.ids.get(&content_key).ok_or_else(|| {
                    Error::Events("LabelsChanged for a message that was never added".into())
                })?;
                self.meta.set_labels(id, &labels)?;
                self.touched.insert(id);
            }
            Event::ImportCompleted {
                import_id, removed, ..
            } => {
                self.flush()?;
                if self.kind == ImportKind::Full {
                    let before: HashSet<MsgId> = self.meta.removed_ids()?.into_iter().collect();
                    let absent: Vec<MsgId> = removed
                        .iter()
                        .filter_map(|k| self.ids.get(k).copied())
                        .collect();
                    self.meta.mark_seen(import_id, &absent)?;
                    let after: HashSet<MsgId> = self.meta.removed_ids()?.into_iter().collect();
                    self.touched.extend(before.symmetric_difference(&after));
                }
                let touched: Vec<MsgId> = std::mem::take(&mut self.touched).into_iter().collect();
                reindex(
                    self.meta,
                    self.store,
                    &mut self.writer,
                    &touched,
                    BATCH_MESSAGES,
                )?;
                self.writer.commit()?;
                self.since_commit = 0;
                self.meta
                    .set_import_status(import_id, ImportStatus::Completed)?;
                self.emit(false);
            }
            Event::ImportRolledBack { .. } => {}
        }
        Ok(())
    }

    /// Read, parse and insert the pending `MessageAdded` events.
    fn flush(&mut self) -> Result<()> {
        if self.batch.is_empty() {
            return Ok(());
        }
        let store = self.store;
        let parsed: Vec<Result<_>> = self
            .batch
            .par_iter()
            .map(|a| {
                let raw = RawMessage {
                    bytes: store.read(a.msg_ref)?,
                    from_line_date: None,
                };
                parse_guarded(&raw)
                    .map(|(p, _)| p)
                    .ok_or_else(|| Error::Store("a stored message no longer parses".into()))
            })
            .collect();
        let Replay {
            meta,
            writer,
            ids,
            batch,
            import_id,
            ..
        } = self;
        let import_id = *import_id;
        meta.transaction(|| {
            for (a, p) in batch.iter().zip(parsed) {
                let mut p = p?;
                p.labels = a.labels.clone();
                let keys = DedupeKeys {
                    content_key: a.content_key,
                    header_key: a.header_key,
                };
                let id = insert_and_index(meta, writer, &p, &keys, a.msg_ref, import_id)?;
                ids.insert(a.content_key, id);
            }
            Ok(())
        })?;
        let n = self.batch.len();
        self.processed += n as u64;
        self.bytes += self.batch_bytes as u64;
        self.since_commit += n;
        self.batch.clear();
        self.batch_bytes = 0;
        if self.since_commit >= COMMIT_EVERY {
            self.writer.commit()?;
            self.since_commit = 0;
        }
        self.emit(false);
        Ok(())
    }
}

/// Build `meta.sqlite.rebuild` and `index.rebuild/` from the log and `store`.
/// Leaves the live files untouched; on any error (cancel included) deletes
/// the partial `*.rebuild` files.
pub(crate) fn build(
    dir: &Path,
    store: &Store,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
) -> Result<()> {
    install_panic_hook();
    remove_rebuild_files(dir)?;
    let r = build_inner(dir, store, progress, cancel);
    if r.is_err() {
        let _ = remove_rebuild_files(dir);
    }
    r
}

fn build_inner(
    dir: &Path,
    store: &Store,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
) -> Result<()> {
    let log = dir.join("events.log");
    // Pass 1: which imports completed, and how much work they hold.
    let mut states: HashMap<u64, LogState> = HashMap::new();
    let mut work: HashMap<u64, (u64, u64)> = HashMap::new();
    try_for_each_event(&log, |e| {
        let st = states.entry(e.import_id()).or_insert(LogState::Open);
        match e {
            Event::ImportCompleted { .. } => *st = LogState::Completed,
            Event::ImportRolledBack { .. } => *st = LogState::RolledBack,
            Event::MessageAdded {
                import_id, msg_ref, ..
            } => {
                let w = work.entry(import_id).or_default();
                w.0 += 1;
                w.1 += u64::from(msg_ref.length);
            }
            _ => {}
        }
        Ok(())
    })?;
    let done: HashSet<u64> = states
        .iter()
        .filter(|(_, s)| **s == LogState::Completed)
        .map(|(id, _)| *id)
        .collect();
    let (total, total_bytes) = done
        .iter()
        .filter_map(|id| work.get(id))
        .fold((0, 0), |a, w| (a.0 + w.0, a.1 + w.1));

    let meta_path = suffixed(dir, META, ".rebuild");
    let meta = MetaDb::open(&meta_path)?;
    let index = match SearchIndex::open_or_create(&suffixed(dir, INDEX, ".rebuild"))? {
        crate::index::OpenedIndex::Ready(i) | crate::index::OpenedIndex::NeedsRebuild(i) => i,
    };
    let mut replay = Replay {
        meta: &meta,
        store,
        writer: index.writer()?,
        done: &done,
        cancel,
        progress,
        total,
        total_bytes,
        started: Instant::now(),
        last_emit: Instant::now() - PROGRESS_EVERY,
        processed: 0,
        bytes: 0,
        ids: HashMap::new(),
        batch: Vec::new(),
        batch_bytes: 0,
        since_commit: 0,
        import_id: 0,
        kind: ImportKind::Partial,
        touched: BTreeSet::new(),
    };
    // Pass 2: replay.
    try_for_each_event(&log, |e| replay.on_event(e))?;
    replay.flush()?;
    if cancel.load(Ordering::Relaxed) {
        return Err(Error::Cancelled);
    }
    replay.writer.commit()?;
    replay.emit(true);
    debug_assert_eq!(replay.processed, replay.total);
    replay.writer.close()?;
    meta.checkpoint()?;
    drop(meta);
    drop(index);
    // Fully checkpointed and closed: sidecars hold nothing.
    for p in &meta_files(dir, ".rebuild")[1..] {
        remove_any(p)?;
    }
    sync_dir(dir)
}
