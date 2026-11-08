//! Apply a scanned import plan to the library, and roll back imports that a
//! crash or cancel interrupted.
//!
//! Write order (durable bytes always precede references to them):
//! 1. `imports` row `running`, then `ImportStarted` (synced).
//! 2. Stream the source again; for each `New`: store append, `MessageAdded`,
//!    SQLite insert, index upsert. After each `COMMIT_EVERY` added messages
//!    sync store, sync log, commit SQLite, commit index.
//! 3. Status `finalizing` + SQLite checkpoint (durable before any older
//!    message is touched); relabels (`LabelsChanged`, `set_labels`), then
//!    `mark_seen` (Full only); re-index touched docs; commit index;
//!    checkpoint; `ImportCompleted` (synced); status `completed`.
//!
//! Recovery (`recover`, run on `Library::open`, before every apply and after
//! a failed one): every import the log leaves open, or whose `imports` row is
//! not `completed`, is resolved. Still `running`: deleted from SQLite and the
//! index, then `ImportRolledBack` is logged. `finalizing`: the same, and the
//! library is flagged for rebuild (labels/removed flags of older messages may
//! already have changed). Logged `ImportCompleted` but row `finalizing`:
//! marked `completed`.

use std::collections::{BTreeSet, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use serde::Serialize;

use super::scan::{Decision, ImportPlan, Progress, ScanReport, install_panic_hook, parse_guarded};
use super::source::open_source;
use super::{BATCH_BYTES, BATCH_MESSAGES, fill_batch};
use crate::events::{Event, LogState, import_states};
use crate::index::{IndexDoc, IndexWriterHandle};
use crate::library::{Library, Parts};
use crate::mbox::MboxReader;
use crate::meta::{ImportStatus, MessageRow, MetaDb};
use crate::model::{DedupeKeys, ImportKind, MessageRef, MsgId, ParsedMessage, RawMessage};
use crate::store::Store;
use crate::{Error, Result};

/// Added messages between durable commits.
const COMMIT_EVERY: usize = 5_000;
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ImportSummary {
    pub import_id: u64,
    pub added: u64,
    pub relabelled: u64,
    /// Messages newly flagged removed by this import.
    pub removed_marked: u64,
    pub parse_errors: u64,
    pub elapsed_secs: f64,
}

/// Where a simulated crash stops an apply (test hook).
#[cfg(any(test, feature = "testing"))]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CrashPoint {
    /// After this many messages were added (earlier batches may be committed).
    AfterAdded(u64),
    /// After the first SQLite commit, before the matching index commit.
    BeforeIndexCommit,
    /// After relabels and removed flags were committed, before `ImportCompleted`.
    Finalizing,
    /// After `ImportCompleted` was synced, before the status became `completed`.
    BeforeCompletedStatus,
}

#[cfg(any(test, feature = "testing"))]
#[derive(Clone, Copy, Default, Debug)]
pub struct TestHooks {
    /// Parse batch size and commit interval (default: production values).
    pub batch: Option<usize>,
    /// Return an error at this point without any cleanup, as a crash would.
    pub crash: Option<CrashPoint>,
}

#[cfg(any(test, feature = "testing"))]
#[derive(Debug)]
struct SimulatedCrash;

#[cfg(any(test, feature = "testing"))]
impl std::fmt::Display for SimulatedCrash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("simulated crash")
    }
}

#[cfg(any(test, feature = "testing"))]
impl std::error::Error for SimulatedCrash {}

#[cfg(any(test, feature = "testing"))]
fn is_simulated_crash(e: &Error) -> bool {
    matches!(e, Error::Io(io) if io.get_ref().is_some_and(|i| i.is::<SimulatedCrash>()))
}

struct Opts {
    parse_batch: usize,
    commit_every: usize,
    #[cfg(any(test, feature = "testing"))]
    crash: Option<CrashPoint>,
}

impl Default for Opts {
    fn default() -> Self {
        Opts {
            parse_batch: BATCH_MESSAGES,
            commit_every: COMMIT_EVERY,
            #[cfg(any(test, feature = "testing"))]
            crash: None,
        }
    }
}

impl Opts {
    /// Fail like a crash at `at`, if the test hook asks for it.
    #[cfg(any(test, feature = "testing"))]
    fn crash_at(&self, at: CrashPoint) -> Result<()> {
        let hit = match (self.crash, at) {
            (Some(CrashPoint::AfterAdded(n)), CrashPoint::AfterAdded(added)) => added >= n,
            (Some(want), at) => want == at,
            (None, _) => false,
        };
        if hit {
            return Err(Error::Io(std::io::Error::other(SimulatedCrash)));
        }
        Ok(())
    }
}

/// Apply `report` (from [`super::scan::scan`]) to `lib`. On cancel, a
/// changed source or any other error, the partial import is rolled back.
pub fn apply(
    lib: &mut Library,
    report: &ScanReport,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
) -> Result<ImportSummary> {
    run(lib, report, progress, cancel, &Opts::default())
}

#[cfg(any(test, feature = "testing"))]
pub fn apply_with_hooks(
    lib: &mut Library,
    report: &ScanReport,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
    hooks: TestHooks,
) -> Result<ImportSummary> {
    let mut opts = Opts {
        crash: hooks.crash,
        ..Opts::default()
    };
    if let Some(b) = hooks.batch {
        opts.parse_batch = b.max(1);
        opts.commit_every = b.max(1);
    }
    run(lib, report, progress, cancel, &opts)
}

fn run(
    lib: &mut Library,
    report: &ScanReport,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
    opts: &Opts,
) -> Result<ImportSummary> {
    install_panic_hook();
    // Resolve any earlier interrupted import first: recovery must never have
    // to look past a newer import to find leftovers.
    recover(lib)?;
    if lib.needs_rebuild() {
        return Err(Error::NeedsRebuild);
    }
    check_fresh(lib.meta(), &report.plan)?;
    match apply_inner(lib, report, progress, cancel, opts) {
        Ok(s) => Ok(s),
        #[cfg(any(test, feature = "testing"))]
        Err(e) if is_simulated_crash(&e) => Err(e),
        Err(e) => match recover(lib) {
            Ok(()) => Err(e),
            Err(re) => {
                // Best effort; the error tells the caller to reopen, and the
                // reopen retries the rollback.
                let _ = lib.mark_needs_rebuild();
                Err(Error::RollbackFailed {
                    cause: e.to_string(),
                    rollback: re.to_string(),
                })
            }
        },
    }
}

/// Refuse a plan made against a library that has changed since the scan.
fn check_fresh(meta: &MetaDb, plan: &ImportPlan) -> Result<()> {
    if meta.latest_completed_import()? != plan.base_import || meta.count()? != plan.base_count {
        return Err(Error::StaleScan);
    }
    Ok(())
}

/// The kind the import is applied and logged as: a full export that looks
/// older than the library, or has no parseable message, only adds mail.
fn applied_kind(r: &ScanReport) -> ImportKind {
    if r.kind == ImportKind::Full && !r.looks_older && r.total > r.parse_errors {
        ImportKind::Full
    } else {
        ImportKind::Partial
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn apply_inner(
    lib: &mut Library,
    report: &ScanReport,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
    opts: &Opts,
) -> Result<ImportSummary> {
    let started = Instant::now();
    let plan = &report.plan;
    if plan.decisions.len() as u64 != plan.total {
        return Err(Error::SourceChanged);
    }
    let kind = applied_kind(report);
    let full = kind == ImportKind::Full;
    let source = open_source(&plan.source_paths)?;
    let bytes_read = source.bytes_read.clone();
    let total_bytes = source.total_bytes;

    let import_id = lib.next_import_id()?;
    let parts = lib.parts();
    let Parts {
        store,
        events,
        meta,
        index,
    } = parts;
    meta.begin_import(import_id, unix_now(), &report.source_label, kind)?;
    events.append(&Event::ImportStarted {
        import_id,
        at: unix_now(),
        source: report.source_label.clone(),
        kind,
    })?;
    events.sync()?;
    let mut writer = index.writer()?;

    let mut last_emit = Instant::now() - PROGRESS_EVERY;
    let emit = |phase: &'static str, processed: u64, force: bool, last: &mut Instant| {
        if force || last.elapsed() >= PROGRESS_EVERY {
            *last = Instant::now();
            let secs = started.elapsed().as_secs_f64();
            progress(Progress {
                phase,
                processed,
                bytes: bytes_read.load(Ordering::Relaxed),
                total_bytes,
                rate_per_sec: if secs > 0.0 {
                    processed as f64 / secs
                } else {
                    0.0
                },
                errors: report.parse_errors,
            });
        }
    };

    // Phase 1: stream the source and add new messages in durable batches.
    let mut mbox = MboxReader::new(source.reader);
    let mut batch: Vec<RawMessage> = Vec::new();
    let mut pos = 0usize;
    let mut added = 0u64;
    let mut relabels: Vec<(MsgId, Vec<String>)> = Vec::new();
    let mut done = false;
    while !done {
        meta.transaction(|| {
            let mut pending = 0usize;
            while !done && pending < opts.commit_every {
                if cancel.load(Ordering::Relaxed) {
                    return Err(Error::Cancelled);
                }
                done = fill_batch(&mut mbox, &mut batch, opts.parse_batch)?;
                let decisions = plan
                    .decisions
                    .get(pos..pos + batch.len())
                    .ok_or(Error::SourceChanged)?;
                let parsed: Vec<_> = batch
                    .par_iter()
                    .zip(decisions)
                    .map(|(raw, d)| match d {
                        Decision::New(_) => parse_guarded(raw),
                        Decision::Relabel(..) if full => parse_guarded(raw),
                        _ => None,
                    })
                    .collect();
                for ((raw, d), parsed) in batch.iter().zip(decisions).zip(parsed) {
                    match *d {
                        Decision::New(key) => {
                            let (p, keys) = parsed.ok_or(Error::SourceChanged)?;
                            if keys.content_key != key {
                                return Err(Error::SourceChanged);
                            }
                            let msg_ref = store.append(&raw.bytes)?;
                            events.append(&Event::MessageAdded {
                                import_id,
                                content_key: keys.content_key,
                                header_key: keys.header_key,
                                msg_ref,
                                labels: p.labels.clone(),
                                from_line_date: raw.from_line_date,
                            })?;
                            insert_and_index(meta, &mut writer, &p, &keys, msg_ref, import_id)?;
                            added += 1;
                            pending += 1;
                            #[cfg(any(test, feature = "testing"))]
                            opts.crash_at(CrashPoint::AfterAdded(added))?;
                        }
                        Decision::Relabel(id, key) if full => {
                            let (p, keys) = parsed.ok_or(Error::SourceChanged)?;
                            if keys.content_key != key {
                                return Err(Error::SourceChanged);
                            }
                            relabels.push((id, p.labels));
                        }
                        _ => {}
                    }
                }
                pos += batch.len();
                emit("import", pos as u64, false, &mut last_emit);
            }
            store.sync()?;
            events.sync()?;
            Ok(())
        })?;
        #[cfg(any(test, feature = "testing"))]
        opts.crash_at(CrashPoint::BeforeIndexCommit)?;
        writer.commit()?;
    }
    drop(batch);
    if pos as u64 != plan.total {
        return Err(Error::SourceChanged);
    }
    emit("import", pos as u64, true, &mut last_emit);

    // Phase 2: finalize. Not cancellable; a crash from here needs a rebuild,
    // so `finalizing` must be durable before any older message changes.
    meta.set_import_status(import_id, ImportStatus::Finalizing)?;
    meta.checkpoint()?;
    let mut touched: Vec<MsgId> = Vec::new();
    if full && !relabels.is_empty() {
        meta.transaction(|| {
            for (id, labels) in &relabels {
                events.append(&Event::LabelsChanged {
                    import_id,
                    content_key: meta.content_key(*id)?,
                    labels: labels.clone(),
                })?;
                meta.set_labels(*id, labels)?;
            }
            Ok(())
        })?;
        touched.extend(relabels.iter().map(|(id, _)| *id));
    }
    let mut removed_keys = Vec::new();
    let mut removed_marked = 0u64;
    if full {
        let before: HashSet<MsgId> = meta.removed_ids()?.into_iter().collect();
        meta.mark_seen(import_id, &plan.removed)?;
        let after: HashSet<MsgId> = meta.removed_ids()?.into_iter().collect();
        removed_marked = after.difference(&before).count() as u64;
        touched.extend(before.symmetric_difference(&after));
        removed_keys = plan
            .removed
            .iter()
            .map(|id| meta.content_key(*id))
            .collect::<Result<_>>()?;
    }
    touched.sort_unstable();
    touched.dedup();
    emit("finalize", pos as u64, true, &mut last_emit);
    reindex(meta, store, &mut writer, &touched, opts.parse_batch)?;
    writer.commit()?;
    writer.close()?;
    #[cfg(any(test, feature = "testing"))]
    opts.crash_at(CrashPoint::Finalizing)?;

    // SQLite must be durable before the log declares the import complete.
    meta.checkpoint()?;
    events.append(&Event::ImportCompleted {
        import_id,
        at: unix_now(),
        removed: removed_keys,
    })?;
    events.sync()?;
    #[cfg(any(test, feature = "testing"))]
    opts.crash_at(CrashPoint::BeforeCompletedStatus)?;
    meta.set_import_status(import_id, ImportStatus::Completed)?;

    Ok(ImportSummary {
        import_id,
        added,
        relabelled: relabels.len() as u64,
        removed_marked,
        parse_errors: report.parse_errors,
        elapsed_secs: started.elapsed().as_secs_f64(),
    })
}

/// Insert a newly added message into SQLite and the index. Shared by import
/// and rebuild so both derive the thread id (Gmail's, else the root message's,
/// else synthetic) and the index document identically.
pub(crate) fn insert_and_index(
    meta: &MetaDb,
    writer: &mut IndexWriterHandle,
    p: &ParsedMessage,
    keys: &DedupeKeys,
    msg_ref: MessageRef,
    import_id: u64,
) -> Result<MsgId> {
    let id = meta.insert_message(p, keys, msg_ref, import_id)?;
    let thrid = meta.thrid_of(id)?;
    writer.upsert(&IndexDoc::from_parsed(id, thrid, import_id, p, false))?;
    Ok(id)
}

/// Re-index existing messages from their stored bytes, taking labels,
/// removed flag, thread id, date and import id from SQLite. Batches are
/// capped like parse batches (message count and raw bytes).
pub(crate) fn reindex(
    meta: &MetaDb,
    store: &Store,
    writer: &mut IndexWriterHandle,
    ids: &[MsgId],
    max_messages: usize,
) -> Result<()> {
    let mut rows: Vec<MessageRow> = Vec::new();
    let mut bytes = 0u64;
    for (i, &id) in ids.iter().enumerate() {
        let row = meta.message(id)?;
        bytes += row.size;
        rows.push(row);
        let last = i + 1 == ids.len();
        if last || rows.len() >= max_messages || bytes >= BATCH_BYTES as u64 {
            reindex_rows(store, writer, &rows)?;
            rows.clear();
            bytes = 0;
        }
    }
    Ok(())
}

fn reindex_rows(store: &Store, writer: &mut IndexWriterHandle, rows: &[MessageRow]) -> Result<()> {
    let docs: Vec<Result<IndexDoc>> = rows
        .par_iter()
        .map(|row| {
            let raw = RawMessage {
                bytes: store.read(row.msg_ref)?,
                from_line_date: None,
            };
            let (parsed, _) = parse_guarded(&raw).ok_or_else(|| {
                Error::Index(format!("stored message {} no longer parses", row.id))
            })?;
            let mut doc = IndexDoc::from_parsed(
                row.id,
                row.thrid,
                row.first_seen_import,
                &parsed,
                row.removed,
            );
            doc.date = row.date;
            doc.labels = row.labels.clone();
            Ok(doc)
        })
        .collect();
    for d in docs {
        writer.upsert(&d?)?;
    }
    Ok(())
}

/// Bring SQLite and the index back in line with the event log after
/// interrupted imports. Cheap when there is nothing to do: the log's last
/// event closes an import and no `imports` row is incomplete.
pub(crate) fn recover(lib: &mut Library) -> Result<()> {
    let log_path = lib.events_path();
    let mut rollback: BTreeSet<u64> = BTreeSet::new();
    let mut already_logged: HashSet<u64> = HashSet::new();
    let mut rebuild = false;
    {
        let p = lib.parts();
        let tail = p.events.last_event()?;
        let tail_closed = matches!(
            tail,
            None | Some(Event::ImportCompleted { .. } | Event::ImportRolledBack { .. })
        );
        let rows = p.meta.incomplete_imports()?;
        // Cheap check of the newest *completed* import (the tail, or found by
        // scanning back past rolled-back ones): SQLite lost its row (deleted
        // or replaced database), so the caches are stale.
        let newest_completed = match &tail {
            Some(Event::ImportCompleted { import_id, .. }) => Some(*import_id),
            Some(Event::ImportRolledBack { .. }) => p.events.last_completed_import()?,
            _ => None,
        };
        if let Some(id) = newest_completed
            && p.meta.import_status(id)?.is_none()
        {
            rebuild = true;
        }
        // A log with events but a SQLite without any import: look closer.
        let no_imports = tail.is_some() && p.meta.latest_import()?.is_none();
        if tail_closed && rows.is_empty() && !rebuild && !no_imports {
            return Ok(());
        }
        let states = import_states(&log_path)?;
        for (&x, &st) in &states {
            if st == LogState::Completed && p.meta.import_status(x)?.is_none() {
                rebuild = true;
            }
            if st != LogState::Open {
                continue;
            }
            match p.meta.import_status(x)? {
                None | Some(ImportStatus::Running) => {}
                Some(ImportStatus::Finalizing | ImportStatus::Completed) => rebuild = true,
            }
            rollback.insert(x);
        }
        for (y, status) in rows {
            match states.get(&y) {
                Some(LogState::Open) => {} // handled above
                // Crash after the log append: SQLite has everything but the status.
                Some(LogState::Completed) if status == ImportStatus::Finalizing => {
                    p.meta.set_import_status(y, ImportStatus::Completed)?;
                }
                // Logged complete but SQLite lost committed work (power loss).
                Some(LogState::Completed) => rebuild = true,
                // Not logged at all (crash before `ImportStarted`), or rolled
                // back but SQLite lost the delete: roll back (again).
                st @ (Some(LogState::RolledBack) | None) => {
                    if st.is_some() {
                        already_logged.insert(y);
                    }
                    if status == ImportStatus::Finalizing {
                        rebuild = true;
                    }
                    rollback.insert(y);
                }
            }
        }
    }
    if rebuild {
        lib.mark_needs_rebuild()?;
    }
    if rollback.is_empty() {
        return Ok(());
    }
    let p = lib.parts();
    // SQLite (made durable), then the index, then the log marker: a crash
    // anywhere in between leaves the import open and recovery repeats.
    for id in &rollback {
        p.meta.delete_import(*id)?;
    }
    p.meta.checkpoint()?;
    let mut w = p.index.writer()?;
    for id in &rollback {
        w.delete_import(*id)?;
    }
    w.commit()?;
    drop(w);
    for &id in rollback.iter().filter(|id| !already_logged.contains(id)) {
        p.events.append(&Event::ImportRolledBack {
            import_id: id,
            at: unix_now(),
        })?;
    }
    p.events.sync()?;
    Ok(())
}
