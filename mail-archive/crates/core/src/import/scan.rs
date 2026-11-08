//! Read-only diff of an import source against the library: classify every
//! source message as new, relabelled, unchanged or skipped.

use std::cell::Cell;
use std::collections::HashSet;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Once;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use serde::Serialize;

use super::source::open_source;
use super::{BATCH_MESSAGES, fill_batch};
use crate::library::Library;
use crate::mbox::MboxReader;
use crate::model::{DedupeKeys, ImportKind, Key, MsgId, ParsedMessage, RawMessage};
use crate::parse::{dedupe_keys, parse_message};
use crate::{Error, Result};

const PROGRESS_EVERY: Duration = Duration::from_millis(100);

#[derive(Serialize, Clone, Debug)]
pub struct Progress {
    pub phase: &'static str,
    pub processed: u64,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub rate_per_sec: f64,
    /// Messages skipped because they could not be processed (counts only).
    pub errors: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Decision {
    /// Add the message; carries its content key so apply can verify that the
    /// source still holds the same message at this position.
    New(Key),
    /// Replace the labels of a library message; carries the source message's
    /// content key for the same check.
    Relabel(MsgId, Key),
    Unchanged,
    Skip,
}

/// One decision per message position in the source, in source order.
#[derive(Default, Clone, Debug)]
pub struct ImportPlan {
    pub decisions: Vec<Decision>,
    /// Latest completed import and message count at scan time; apply refuses
    /// a plan whose library has changed since.
    pub base_import: Option<u64>,
    pub base_count: u64,
    /// Library messages to mark removed (Full imports that do not look older).
    pub removed: Vec<MsgId>,
    pub source_paths: Vec<PathBuf>,
    /// Number of messages seen in the source, to detect a changed source.
    pub total: u64,
}

#[derive(Serialize, Debug)]
pub struct ScanReport {
    pub kind: ImportKind,
    pub source_label: String,
    pub total: u64,
    pub new: u64,
    pub label_changes: u64,
    pub unchanged: u64,
    pub removed: u64,
    pub removed_fraction: f64,
    pub matched_by_content: u64,
    pub matched_by_header: u64,
    pub parse_errors: u64,
    pub duplicates_in_source: u64,
    pub looks_older: bool,
    #[serde(skip)]
    pub plan: ImportPlan,
}

/// What classification needs from a parsed message.
struct Keyed {
    keys: DedupeKeys,
    thrid: Option<u64>,
    labels: HashSet<String>,
    date: i64,
}

thread_local! {
    static IN_PARSE: Cell<bool> = const { Cell::new(false) };
}

/// Replace panic output from inside message parsing (which can quote message
/// text) with a fixed line; everything else goes to the previous hook.
pub fn install_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if IN_PARSE.with(Cell::get) {
                eprintln!("mail-archive: message parser panicked (message skipped)");
            } else {
                prev(info);
            }
        }));
    });
}

/// Parse a message and compute its dedupe keys, turning parser errors and
/// panics into `None`. Call [`install_panic_hook`] once before using it.
pub(crate) fn parse_guarded(raw: &RawMessage) -> Option<(ParsedMessage, DedupeKeys)> {
    IN_PARSE.with(|f| f.set(true));
    let parsed = catch_unwind(AssertUnwindSafe(|| {
        let parsed = parse_message(raw).ok()?;
        let keys = dedupe_keys(raw, &parsed);
        Some((parsed, keys))
    }));
    IN_PARSE.with(|f| f.set(false));
    parsed.ok().flatten()
}

fn parse_keyed(raw: &RawMessage) -> Option<Keyed> {
    let (parsed, keys) = parse_guarded(raw)?;
    Some(Keyed {
        keys,
        thrid: parsed.thrid,
        labels: parsed.labels.into_iter().collect(),
        date: parsed.date,
    })
}

pub fn scan(
    lib: &Library,
    paths: &[PathBuf],
    progress: &dyn Fn(Progress),
    cancel: &AtomicBool,
) -> Result<ScanReport> {
    install_panic_hook();
    if lib.needs_rebuild() {
        return Err(Error::NeedsRebuild);
    }
    let base_import = lib.meta().latest_completed_import()?;
    let source = open_source(paths)?;
    let kind = source.kind;
    let ki = lib.meta().key_index()?;
    let library_count = lib.meta().count()?;
    let latest = lib.meta().latest_message_date()?;

    let started = Instant::now();
    let mut last_emit = Instant::now() - PROGRESS_EVERY;
    let emit = |processed: u64, force: bool, last: &mut Instant| {
        if force || last.elapsed() >= PROGRESS_EVERY {
            *last = Instant::now();
            let secs = started.elapsed().as_secs_f64();
            progress(Progress {
                phase: "scan",
                processed,
                bytes: source.bytes_read.load(Ordering::Relaxed),
                total_bytes: source.total_bytes,
                rate_per_sec: if secs > 0.0 {
                    processed as f64 / secs
                } else {
                    0.0
                },
                errors: 0,
            });
        }
    };

    let mut mbox = MboxReader::new(source.reader);
    let mut decisions: Vec<Decision> = Vec::new();
    let mut matched: HashSet<MsgId> = HashSet::new();
    let mut seen: HashSet<Key> = HashSet::new();
    let (mut new, mut label_changes, mut unchanged) = (0u64, 0u64, 0u64);
    let (mut by_content, mut by_header) = (0u64, 0u64);
    let (mut parse_errors, mut duplicates) = (0u64, 0u64);
    let mut newest: Option<i64> = None;
    let relabels_allowed = kind == ImportKind::Full;

    let mut batch: Vec<RawMessage> = Vec::new();
    let mut done = false;
    while !done {
        if cancel.load(Ordering::Relaxed) {
            return Err(Error::Cancelled);
        }
        done = fill_batch(&mut mbox, &mut batch, BATCH_MESSAGES)?;
        let keyed: Vec<Option<Keyed>> = batch.par_iter().map(parse_keyed).collect();
        for k in keyed {
            let Some(k) = k else {
                parse_errors += 1;
                decisions.push(Decision::Skip);
                continue;
            };
            if !seen.insert(k.keys.content_key) {
                duplicates += 1;
                decisions.push(Decision::Skip);
                continue;
            }
            newest = Some(newest.map_or(k.date, |n| n.max(k.date)));

            let hit = if let Some(&id) = ki.by_content.get(&k.keys.content_key) {
                by_content += 1;
                Some(id)
            } else {
                let found = k
                    .keys
                    .header_key
                    .and_then(|h| ki.by_header.get(&h))
                    .and_then(|cands| {
                        cands.iter().find(|(id, t)| {
                            !matched.contains(id)
                                && (t.is_none() || k.thrid.is_none() || *t == k.thrid)
                        })
                    })
                    .map(|&(id, _)| id);
                by_header += u64::from(found.is_some());
                found
            };
            let Some(id) = hit else {
                new += 1;
                decisions.push(Decision::New(k.keys.content_key));
                continue;
            };
            let first_claim = matched.insert(id);
            let lib_labels: HashSet<&str> = ki
                .labels
                .get(&id)
                .map(|v| v.iter().map(String::as_str).collect())
                .unwrap_or_default();
            let same = lib_labels.len() == k.labels.len()
                && k.labels.iter().all(|l| lib_labels.contains(l.as_str()));
            if same || !first_claim || !relabels_allowed {
                unchanged += 1;
                decisions.push(Decision::Unchanged);
            } else {
                label_changes += 1;
                decisions.push(Decision::Relabel(id, k.keys.content_key));
            }
        }
        emit(decisions.len() as u64, false, &mut last_emit);
    }
    emit(decisions.len() as u64, true, &mut last_emit);

    let looks_older =
        matches!((latest, newest), (Some(lib), Some(src)) if library_count > 0 && src < lib);
    // A source with nothing parseable must also never plan to remove the library.
    let suppress = looks_older || newest.is_none();
    if suppress {
        for d in &mut decisions {
            if matches!(d, Decision::Relabel(..)) {
                *d = Decision::Unchanged;
            }
        }
        unchanged += label_changes;
        label_changes = 0;
    }

    let mut removed: Vec<MsgId> = Vec::new();
    if kind == ImportKind::Full && !suppress {
        removed = ki
            .by_content
            .values()
            .copied()
            .filter(|id| !matched.contains(id))
            .collect();
        removed.sort_unstable();
    }
    let removed_fraction = if library_count == 0 {
        0.0
    } else {
        removed.len() as f64 / library_count as f64
    };

    let total = decisions.len() as u64;
    Ok(ScanReport {
        kind,
        source_label: source.label,
        total,
        new,
        label_changes,
        unchanged,
        removed: removed.len() as u64,
        removed_fraction,
        matched_by_content: by_content,
        matched_by_header: by_header,
        parse_errors,
        duplicates_in_source: duplicates,
        looks_older,
        plan: ImportPlan {
            decisions,
            base_import,
            base_count: library_count,
            removed,
            source_paths: paths.to_vec(),
            total,
        },
    })
}
