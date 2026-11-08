//! Apply a scanned import plan to the library, and roll back imports that a
//! crash or cancel interrupted.
//!
//! Write order (durable bytes always precede references to them):
//! 1. `imports` row `running`, then `ImportStarted` (synced).
//! 2. Stream the source again; for each `New`: store append, `MessageAdded`,
//!    SQLite insert, index upsert. After each `COMMIT_EVERY` added messages
//!    sync store, sync log, commit SQLite, commit index.
//! 3. Status `finalizing`; relabels (`LabelsChanged`, `set_labels`), then
//!    `mark_seen` (Full only); re-index touched docs; commit index;
//!    checkpoint SQLite; `ImportCompleted` (synced); status `completed`.
//!
//! Recovery (`recover`, run on `Library::open` and after a failed apply):
//! an import still `running` is deleted from SQLite and the index; one that
//! was `finalizing` is deleted too and the library is flagged for rebuild
//! (relabels/removed flags of older messages may already be changed); one
//! whose `ImportCompleted` is in the log is simply marked `completed`.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use serde::Serialize;

use super::scan::{Decision, Progress, ScanReport, install_panic_hook, parse_guarded};
use super::source::open_source;
use crate::events::Event;
use crate::index::{IndexDoc, IndexWriterHandle};
use crate::library::{Library, Parts};
use crate::mbox::MboxReader;
use crate::meta::{ImportStatus, MetaDb};
use crate::model::{ImportKind, MsgId, RawMessage};
use crate::store::Store;
use crate::{Error, Result};

/// Messages read and parsed together (bounds memory to one batch of bytes).
const PARSE_BATCH: usize = 2_000;
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
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CrashPoint {
    /// After this many messages were added (at least one commit may have happened).
    AfterAdded(u64),
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

struct Opts {
    parse_batch: usize,
    commit_every: usize,
    crash: Option<CrashPoint>,
}

impl Default for Opts {
    fn default() -> Self {
        Opts {
            parse_batch: PARSE_BATCH,
            commit_every: COMMIT_EVERY,
            crash: None,
        }
    }
}

impl Opts {
    /// Simulate a crash at `at` if requested; sets `crashed` so the caller
    /// skips cleanup.
    fn crash_at(&self, at: CrashPoint, crashed: &mut bool) -> Result<()> {
        let hit = match (self.crash, at) {
            (Some(CrashPoint::AfterAdded(n)), CrashPoint::AfterAdded(added)) => added >= n,
            (Some(want), at) => want == at,
            (None, _) => false,
        };
        if hit {
            *crashed = true;
            return Err(Error::Io(std::io::Error::other("simulated crash")));
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
    let mut crashed = false;
    match apply_inner(lib, report, progress, cancel, opts, &mut crashed) {
        Ok(s) => Ok(s),
        Err(e) if crashed => Err(e),
        Err(e) => {
            // Best effort: if this fails too, the next open retries it.
            let _ = recover(lib);
            Err(e)
        }
    }
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

/// One past the highest import id in the event log or SQLite.
fn next_import_id(p: &mut Parts<'_>) -> Result<u64> {
    let log = p.events.last_event()?.map_or(0, |e| e.import_id());
    let db = p.meta.latest_import()?.map_or(0, |(id, _, _)| id);
    Ok(log.max(db) + 1)
}

fn apply_inner(
    lib: &mut Library,
    report: &ScanReport,
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
    opts: &Opts,
    crashed: &mut bool,
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

    let mut parts = lib.parts();
    let import_id = next_import_id(&mut parts)?;
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
            });
        }
    };

    // Phase 1: stream the source and add new messages in durable batches.
    let mut mbox = MboxReader::new(source.reader);
    let mut batch: Vec<RawMessage> = Vec::with_capacity(opts.parse_batch);
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
                batch.clear();
                while batch.len() < opts.parse_batch {
                    match mbox.next() {
                        Some(m) => batch.push(m?),
                        None => {
                            done = true;
                            break;
                        }
                    }
                }
                let decisions = plan
                    .decisions
                    .get(pos..pos + batch.len())
                    .ok_or(Error::SourceChanged)?;
                let parsed: Vec<_> = batch
                    .par_iter()
                    .zip(decisions)
                    .map(|(raw, d)| match d {
                        Decision::New(_) => parse_guarded(raw),
                        Decision::Relabel(_) if full => parse_guarded(raw),
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
                            })?;
                            let id = meta.insert_message(&p, &keys, msg_ref, import_id)?;
                            let thrid = meta.thrid_of(id)?;
                            writer
                                .upsert(&IndexDoc::from_parsed(id, thrid, import_id, &p, false))?;
                            added += 1;
                            pending += 1;
                            opts.crash_at(CrashPoint::AfterAdded(added), crashed)?;
                        }
                        Decision::Relabel(id) if full => {
                            let (p, _) = parsed.ok_or(Error::SourceChanged)?;
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
        writer.commit()?;
    }
    drop(batch);
    if pos as u64 != plan.total {
        return Err(Error::SourceChanged);
    }
    emit("import", pos as u64, true, &mut last_emit);

    // Phase 2: finalize. Not cancellable; a crash from here needs a rebuild.
    meta.set_import_status(import_id, ImportStatus::Finalizing)?;
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
    drop(writer);
    opts.crash_at(CrashPoint::Finalizing, crashed)?;

    // SQLite must be durable before the log declares the import complete.
    meta.checkpoint()?;
    events.append(&Event::ImportCompleted {
        import_id,
        at: unix_now(),
        removed: removed_keys,
    })?;
    events.sync()?;
    opts.crash_at(CrashPoint::BeforeCompletedStatus, crashed)?;
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

/// Re-index existing messages from their stored bytes, taking labels,
/// removed flag, thread id, date and import id from SQLite.
fn reindex(
    meta: &MetaDb,
    store: &Store,
    writer: &mut IndexWriterHandle,
    ids: &[MsgId],
    batch: usize,
) -> Result<()> {
    for chunk in ids.chunks(batch) {
        let rows = chunk
            .iter()
            .map(|&id| meta.message(id))
            .collect::<Result<Vec<_>>>()?;
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
    }
    Ok(())
}

/// Bring SQLite and the index back in line with the event log after an
/// interrupted import. Cheap when there is nothing to do (reads only the log
/// tail and the latest `imports` row).
pub(crate) fn recover(lib: &mut Library) -> Result<()> {
    let mut rollback: Vec<u64> = Vec::new();
    let mut rebuild = false;
    {
        let p = lib.parts();
        let last = p.events.last_event()?;
        let latest = p.meta.latest_import()?;
        let logged_complete = match &last {
            Some(Event::ImportCompleted { import_id, .. }) => Some(*import_id),
            _ => None,
        };
        // The log's last import never completed.
        if let Some(e) = &last
            && logged_complete.is_none()
        {
            let x = e.import_id();
            match p.meta.import_status(x)? {
                Some(ImportStatus::Running) => rollback.push(x),
                Some(ImportStatus::Finalizing | ImportStatus::Completed) => {
                    rebuild = true;
                    rollback.push(x);
                }
                // Already rolled back, unless a previous rollback was cut short.
                None => {
                    if p.meta.has_messages_from(x)? || p.index.import_doc_count(x)? > 0 {
                        rollback.push(x);
                    }
                }
            }
        }
        // SQLite's latest import never completed.
        if let Some((y, _, status)) = latest
            && status != ImportStatus::Completed
            && !rollback.contains(&y)
        {
            match (status, logged_complete == Some(y)) {
                // Crash after the log append: SQLite has everything but the status.
                (ImportStatus::Finalizing, true) => {
                    p.meta.set_import_status(y, ImportStatus::Completed)?;
                }
                // Logged complete but SQLite lost committed work (power loss).
                (_, true) => rebuild = true,
                (ImportStatus::Finalizing, false) => {
                    rebuild = true;
                    rollback.push(y);
                }
                _ => rollback.push(y),
            }
        }
    }
    if rebuild {
        lib.mark_needs_rebuild()?;
    }
    if !rollback.is_empty() {
        let p = lib.parts();
        // SQLite first: a crash in between leaves index docs, which the next
        // recovery finds via `import_doc_count`.
        for id in &rollback {
            p.meta.delete_import(*id)?;
        }
        let mut w = p.index.writer()?;
        for id in &rollback {
            w.delete_import(*id)?;
        }
        w.commit()?;
    }
    Ok(())
}
