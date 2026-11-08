use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use mail_core::Error;
use mail_core::events::{Event, completed_events, read_events};
use mail_core::import::apply::{CrashPoint, ImportSummary, TestHooks, apply, apply_with_hooks};
use mail_core::import::scan::{ScanReport, scan};
use mail_core::library::{Library, SearchResults};
use mail_core::meta::{ImportStatus, MetaDb};
use mail_core::model::{ImportKind, RawMessage};
use mail_core::parse::{dedupe_keys, parse_message};
use mail_core::testing::{MsgBuilder, mbox_of, zip_of};
use tempfile::TempDir;

const FULL: &str = "All mail Including Spam and Trash.mbox";
const NOW: i64 = 1_800_000_000;

fn m(n: u32, day: u32, labels: &[&str]) -> Vec<u8> {
    MsgBuilder::new()
        .from(&format!("Sender {n} <sender{n}@example.com>"))
        .subject(&format!("subject{n} topic"))
        .date_rfc2822(&format!("Mon, {day:02} Nov 2026 10:00:00 +0000"))
        .message_id(Some(&format!("<m{n}@fixture>")))
        .thrid(1000 + n as u64)
        .labels(labels)
        .text(&format!("body of message {n} word{n}"))
        .build()
}

fn range(r: std::ops::RangeInclusive<u32>) -> Vec<Vec<u8>> {
    r.map(|n| m(n, 2, &["Inbox"])).collect()
}

fn full_zip(dir: &Path, name: &str, msgs: &[Vec<u8>]) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, zip_of(&format!("Takeout/Mail/{FULL}"), &mbox_of(msgs))).unwrap();
    p
}

fn no_cancel() -> AtomicBool {
    AtomicBool::new(false)
}

fn import(lib: &mut Library, p: &Path) -> ImportSummary {
    lib.import(&[p.to_path_buf()], &|_| {}, &no_cancel())
        .unwrap()
}

fn scan_of(lib: &Library, p: &Path) -> ScanReport {
    scan(lib, &[p.to_path_buf()], &|_| {}, &no_cancel()).unwrap()
}

fn search(lib: &Library, q: &str) -> SearchResults {
    lib.search(q, 0, 100, NOW, &Utc).unwrap()
}

fn content_key(bytes: &[u8]) -> [u8; 32] {
    let raw = RawMessage {
        bytes: bytes.to_vec(),
        from_line_date: None,
    };
    dedupe_keys(&raw, &parse_message(&raw).unwrap()).content_key
}

fn events(dir: &Path) -> Vec<Event> {
    read_events(&dir.join("events.log")).unwrap()
}

fn completed_ids(dir: &Path) -> Vec<u64> {
    let mut ids: Vec<u64> = completed_events(events(dir))
        .iter()
        .filter_map(|e| match e {
            Event::ImportCompleted { import_id, .. } => Some(*import_id),
            _ => None,
        })
        .collect();
    ids.dedup();
    ids
}

fn import_status(lib_dir: &Path, id: u64) -> Option<ImportStatus> {
    MetaDb::open(&lib_dir.join("meta.sqlite"))
        .unwrap()
        .import_status(id)
        .unwrap()
}

struct Fixture {
    _tmp: TempDir,
    lib_dir: PathBuf,
    src: PathBuf,
}

fn fixture() -> Fixture {
    let tmp = TempDir::new().unwrap();
    let lib_dir = tmp.path().join("lib");
    let src = tmp.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    Fixture {
        _tmp: tmp,
        lib_dir,
        src,
    }
}

#[test]
fn import_then_search() {
    let f = fixture();
    let ana = |n: u32, body: &str| {
        MsgBuilder::new()
            .from("Ana Lopez <ana@example.com>")
            .to("bob@example.com")
            .subject("Lunch plans")
            .date_rfc2822(&format!("Mon, 0{n} Nov 2026 12:00:00 +0000"))
            .message_id(Some(&format!("<ana{n}@fixture>")))
            .thrid(77)
            .labels(&["Inbox"])
            .text(body)
            .build()
    };
    let no_thrid = MsgBuilder::new()
        .from("carol@example.com")
        .subject("orphan zebra")
        .message_id(Some("<orphan@fixture>"))
        .text("no gmail thread id here")
        .build();
    let mut msgs = vec![ana(2, "noon?"), ana(3, "or one?"), no_thrid];
    msgs.push(b"\x00\x01 not a message".to_vec());
    msgs.extend(range(1..=2));
    let zip = full_zip(&f.src, "takeout.zip", &msgs);

    let mut lib = Library::open(&f.lib_dir).unwrap();
    let s = import(&mut lib, &zip);
    assert_eq!(s.import_id, 1);
    assert_eq!((s.added, s.relabelled, s.removed_marked), (5, 0, 0));
    assert_eq!(s.parse_errors, 1);
    assert_eq!(lib.count().unwrap(), 5);
    assert!(!lib.needs_rebuild());

    let r = search(&lib, "from:ana");
    assert_eq!(r.threads.len(), 1);
    assert_eq!(r.threads[0].thrid, 77);
    assert_eq!(r.threads[0].message_count, 2);
    assert_eq!(r.total_messages, 2);
    assert_eq!(lib.thread(77).unwrap().len(), 2);

    // A message without X-GM-THRID gets a synthetic thread id in SQLite;
    // the index must carry the same id so the hit resolves to its thread.
    let r = search(&lib, "zebra");
    assert_eq!(r.threads.len(), 1);
    let t = lib.thread(r.threads[0].thrid).unwrap();
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].subject, "orphan zebra");
    assert_eq!(r.threads[0].message_count, 1);

    assert_eq!(completed_ids(&f.lib_dir), vec![1]);
    assert_eq!(import_status(&f.lib_dir, 1), Some(ImportStatus::Completed));
}

#[test]
fn reimport_is_idempotent() {
    let f = fixture();
    let zip = full_zip(&f.src, "a.zip", &range(1..=10));
    let mut lib = Library::open(&f.lib_dir).unwrap();
    let first = import(&mut lib, &zip);
    assert_eq!(first.added, 10);
    let second = import(&mut lib, &zip);
    assert_eq!(second.import_id, 2);
    assert_eq!(
        (second.added, second.relabelled, second.removed_marked),
        (0, 0, 0)
    );
    assert_eq!(lib.count().unwrap(), 10);
    assert_eq!(search(&lib, "topic").total_messages, 10);
    assert!(!lib.needs_rebuild());
    drop(lib);
    let lib = Library::open(&f.lib_dir).unwrap();
    assert_eq!(lib.count().unwrap(), 10);
    assert!(!lib.needs_rebuild());
    assert_eq!(completed_ids(&f.lib_dir), vec![1, 2]);
}

#[test]
fn diff_import_end_to_end() {
    let f = fixture();
    let a = range(1..=4);
    let mut a2 = vec![m(2, 2, &["Inbox", "NewLabel"])];
    a2.extend(range(3..=4));
    a2.push(m(5, 6, &["Inbox"]));
    let za = full_zip(&f.src, "a.zip", &a);
    let za2 = full_zip(&f.src, "a2.zip", &a2);

    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);
    let s = import(&mut lib, &za2);
    assert_eq!(
        (s.added, s.relabelled, s.removed_marked),
        (1, 1, 1),
        "{s:?}"
    );
    assert_eq!(lib.count().unwrap(), 5);

    // Labels updated in SQLite and in the index.
    let t2 = lib.thread(1002).unwrap();
    assert_eq!(
        t2[0].labels,
        vec!["Inbox".to_string(), "NewLabel".to_string()]
    );
    let r = search(&lib, "label:newlabel");
    assert_eq!(r.threads.len(), 1);
    assert_eq!(r.threads[0].thrid, 1002);
    assert_eq!(search(&lib, "label:inbox subject2").threads.len(), 1);

    // The missing message is flagged, still searchable and still opens.
    let r = search(&lib, "is:removed");
    assert_eq!(r.threads.len(), 1);
    assert_eq!(r.threads[0].thrid, 1001);
    let t1 = lib.thread(1001).unwrap();
    assert_eq!(t1.len(), 1);
    assert!(t1[0].removed);
    assert_eq!(lib.raw(t1[0].id).unwrap(), a[0]);
    assert_eq!(search(&lib, "subject1").threads.len(), 1);
    assert!(!lib.needs_rebuild());

    // The log records the relabel and the removed content keys.
    let evs = completed_events(events(&f.lib_dir));
    assert!(evs.iter().any(|e| matches!(e,
        Event::LabelsChanged { import_id: 2, content_key: k, labels }
            if *k == content_key(&a[1]) && labels.contains(&"NewLabel".to_string()))));
    let removed = evs
        .iter()
        .find_map(|e| match e {
            Event::ImportCompleted {
                import_id: 2,
                removed,
                ..
            } => Some(removed.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(removed, vec![content_key(&a[0])]);

    // A later full export that has the message again clears the flag:
    // removed is a function of the latest full import.
    let mut a3 = a.clone();
    a3.push(m(5, 6, &["Inbox"]));
    let s = import(&mut lib, &full_zip(&f.src, "a3.zip", &a3));
    assert_eq!((s.added, s.relabelled, s.removed_marked), (0, 1, 0));
    assert!(search(&lib, "is:removed").threads.is_empty());
    assert!(!lib.thread(1001).unwrap()[0].removed);
    assert!(search(&lib, "label:newlabel").threads.is_empty());
    assert!(!lib.needs_rebuild());
}

#[test]
fn older_export_is_applied_as_partial() {
    let f = fixture();
    let mut have = range(1..=3);
    have.push(m(4, 9, &["Inbox"])); // library newest
    let za = full_zip(&f.src, "a.zip", &have);
    // Older export: lacks 2..=4, relabels 1, has one new old message.
    let old = vec![m(1, 2, &["Inbox", "Work"]), m(9, 1, &["Inbox"])];
    let zold = full_zip(&f.src, "old.zip", &old);

    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);
    let report = scan_of(&lib, &zold);
    assert!(report.looks_older);
    let s = apply(&mut lib, &report, &|_| {}, &no_cancel()).unwrap();
    assert_eq!((s.added, s.relabelled, s.removed_marked), (1, 0, 0));
    assert!(search(&lib, "is:removed").threads.is_empty());
    assert!(search(&lib, "label:work").threads.is_empty());
    let evs = events(&f.lib_dir);
    assert!(evs.iter().any(|e| matches!(
        e,
        Event::ImportStarted {
            import_id: 2,
            kind: ImportKind::Partial,
            ..
        }
    )));
    assert!(evs.iter().any(|e| matches!(
        e,
        Event::ImportCompleted { import_id: 2, removed, .. } if removed.is_empty()
    )));
    assert!(!evs.iter().any(|e| matches!(e, Event::LabelsChanged { .. })));
}

/// Library with `range(1..=3)` imported as import 1, plus a source with 20
/// further new messages.
fn lib_and_big_source(f: &Fixture) -> (Library, PathBuf) {
    let za = full_zip(&f.src, "a.zip", &range(1..=3));
    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);
    let big = full_zip(&f.src, "big.zip", &range(1..=23));
    (lib, big)
}

fn assert_rolled_back(lib_dir: &Path, import_id: u64) {
    let lib = Library::open(lib_dir).unwrap();
    assert_eq!(lib.count().unwrap(), 3);
    assert_eq!(search(&lib, "topic").total_messages, 3);
    assert!(search(&lib, "subject15").threads.is_empty());
    assert!(!lib.needs_rebuild());
    assert!(!completed_ids(lib_dir).contains(&import_id));
    drop(lib);
    assert_eq!(import_status(lib_dir, import_id), None);
}

#[test]
fn cancel_rolls_back() {
    let f = fixture();
    let (mut lib, big) = lib_and_big_source(&f);
    let report = scan_of(&lib, &big);
    assert_eq!(report.new, 20);
    let cancel = AtomicBool::new(false);
    let hooks = TestHooks {
        batch: Some(3),
        crash: None,
    };
    let e = apply_with_hooks(
        &mut lib,
        &report,
        &|p| {
            if p.processed >= 6 {
                cancel.store(true, Ordering::Relaxed);
            }
        },
        &cancel,
        hooks,
    )
    .unwrap_err();
    assert!(matches!(e, Error::Cancelled), "{e:?}");
    // Rolled back immediately, before any reopen.
    assert_eq!(lib.count().unwrap(), 3);
    assert!(search(&lib, "subject15").threads.is_empty());
    drop(lib);
    assert_rolled_back(&f.lib_dir, 2);

    // A fresh import afterwards succeeds with a new id.
    let mut lib = Library::open(&f.lib_dir).unwrap();
    let s = import(&mut lib, &big);
    assert_eq!((s.import_id, s.added), (3, 20));
    assert_eq!(search(&lib, "topic").total_messages, 23);
}

#[test]
fn crash_rolls_back() {
    let f = fixture();
    let (mut lib, big) = lib_and_big_source(&f);
    let report = scan_of(&lib, &big);
    let hooks = TestHooks {
        batch: Some(3),
        crash: Some(CrashPoint::AfterAdded(10)),
    };
    assert!(apply_with_hooks(&mut lib, &report, &|_| {}, &no_cancel(), hooks).is_err());
    drop(lib);
    // The crash left committed rows behind (so recovery has work to do).
    let meta = MetaDb::open(&f.lib_dir.join("meta.sqlite")).unwrap();
    assert!(meta.count().unwrap() > 3);
    assert_eq!(meta.import_status(2).unwrap(), Some(ImportStatus::Running));
    drop(meta);

    assert_rolled_back(&f.lib_dir, 2);

    let mut lib = Library::open(&f.lib_dir).unwrap();
    let s = import(&mut lib, &big);
    assert_eq!((s.import_id, s.added), (3, 20));
    assert_eq!(lib.count().unwrap(), 23);
    assert_eq!(search(&lib, "topic").total_messages, 23);
    assert_eq!(completed_ids(&f.lib_dir), vec![1, 3]);
}

#[test]
fn interrupted_rollback_is_finished_on_open() {
    let f = fixture();
    let (mut lib, big) = lib_and_big_source(&f);
    let report = scan_of(&lib, &big);
    let hooks = TestHooks {
        batch: Some(3),
        crash: Some(CrashPoint::AfterAdded(10)),
    };
    assert!(apply_with_hooks(&mut lib, &report, &|_| {}, &no_cancel(), hooks).is_err());
    drop(lib);
    // A crash during recovery itself: SQLite already rolled back, index not.
    MetaDb::open(&f.lib_dir.join("meta.sqlite"))
        .unwrap()
        .delete_import(2)
        .unwrap();
    assert_rolled_back(&f.lib_dir, 2);
}

#[test]
fn running_row_without_log_events_is_removed() {
    let f = fixture();
    let za = full_zip(&f.src, "a.zip", &range(1..=3));
    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);
    drop(lib);
    // Crash between the `imports` row and the synced `ImportStarted`.
    MetaDb::open(&f.lib_dir.join("meta.sqlite"))
        .unwrap()
        .begin_import(2, 0, "x", ImportKind::Full)
        .unwrap();
    let mut lib = Library::open(&f.lib_dir).unwrap();
    assert_eq!(lib.count().unwrap(), 3);
    assert!(!lib.needs_rebuild());
    let s = import(&mut lib, &full_zip(&f.src, "b.zip", &range(1..=4)));
    assert_eq!((s.import_id, s.added), (2, 1));
    drop(lib);
    assert_eq!(import_status(&f.lib_dir, 2), Some(ImportStatus::Completed));
}

#[test]
fn crash_while_finalizing_rolls_back_and_flags_rebuild() {
    let f = fixture();
    let za = full_zip(&f.src, "a.zip", &range(1..=3));
    let mut a2 = vec![m(1, 2, &["Inbox", "Work"])];
    a2.extend(range(2..=3));
    a2.push(m(4, 5, &["Inbox"]));
    let za2 = full_zip(&f.src, "a2.zip", &a2);
    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);
    let report = scan_of(&lib, &za2);
    let hooks = TestHooks {
        batch: None,
        crash: Some(CrashPoint::Finalizing),
    };
    assert!(apply_with_hooks(&mut lib, &report, &|_| {}, &no_cancel(), hooks).is_err());
    drop(lib);
    assert_eq!(import_status(&f.lib_dir, 2), Some(ImportStatus::Finalizing));

    let lib = Library::open(&f.lib_dir).unwrap();
    assert_eq!(lib.count().unwrap(), 3);
    assert!(search(&lib, "subject4").threads.is_empty());
    assert!(lib.needs_rebuild());
    assert!(!completed_ids(&f.lib_dir).contains(&2));
    drop(lib);
    // The flag persists across opens until a rebuild clears it.
    let lib = Library::open(&f.lib_dir).unwrap();
    assert!(lib.needs_rebuild());
}

#[test]
fn crash_after_log_completed_finishes_import() {
    let f = fixture();
    let za = full_zip(&f.src, "a.zip", &range(1..=3));
    let za2 = full_zip(&f.src, "a2.zip", &range(1..=5));
    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);
    let report = scan_of(&lib, &za2);
    let hooks = TestHooks {
        batch: None,
        crash: Some(CrashPoint::BeforeCompletedStatus),
    };
    assert!(apply_with_hooks(&mut lib, &report, &|_| {}, &no_cancel(), hooks).is_err());
    drop(lib);
    assert_eq!(import_status(&f.lib_dir, 2), Some(ImportStatus::Finalizing));

    let lib = Library::open(&f.lib_dir).unwrap();
    assert_eq!(lib.count().unwrap(), 5);
    assert_eq!(search(&lib, "topic").total_messages, 5);
    assert!(!lib.needs_rebuild());
    drop(lib);
    assert_eq!(import_status(&f.lib_dir, 2), Some(ImportStatus::Completed));
    assert_eq!(completed_ids(&f.lib_dir), vec![1, 2]);
}

#[test]
fn source_changed_between_scan_and_apply() {
    let f = fixture();
    let za = full_zip(&f.src, "a.zip", &range(1..=3));
    let mut lib = Library::open(&f.lib_dir).unwrap();
    import(&mut lib, &za);

    // Fewer messages on the second pass.
    let p = full_zip(&f.src, "b.zip", &range(1..=8));
    let report = scan_of(&lib, &p);
    full_zip(&f.src, "b.zip", &range(1..=7));
    let e = apply(&mut lib, &report, &|_| {}, &no_cancel()).unwrap_err();
    assert!(matches!(e, Error::SourceChanged), "{e:?}");
    assert_eq!(lib.count().unwrap(), 3);

    // More messages on the second pass.
    let report = scan_of(&lib, &p);
    full_zip(&f.src, "b.zip", &range(1..=9));
    let e = apply(&mut lib, &report, &|_| {}, &no_cancel()).unwrap_err();
    assert!(matches!(e, Error::SourceChanged), "{e:?}");
    assert_eq!(lib.count().unwrap(), 3);

    // Same count, different message at a New position.
    let report = scan_of(&lib, &p);
    let mut swapped = range(1..=7);
    swapped.push(m(99, 2, &["Inbox"]));
    full_zip(&f.src, "b.zip", &swapped);
    let e = apply(&mut lib, &report, &|_| {}, &no_cancel()).unwrap_err();
    assert!(matches!(e, Error::SourceChanged), "{e:?}");
    assert_eq!(lib.count().unwrap(), 3);
    assert!(search(&lib, "subject5").threads.is_empty());
    drop(lib);

    let lib = Library::open(&f.lib_dir).unwrap();
    assert_eq!(lib.count().unwrap(), 3);
    assert_eq!(search(&lib, "topic").total_messages, 3);
    assert!(!lib.needs_rebuild());
    assert_eq!(completed_ids(&f.lib_dir), vec![1]);
}

#[test]
fn import_ids_continue_after_rollback() {
    let f = fixture();
    let (mut lib, big) = lib_and_big_source(&f);
    let report = scan_of(&lib, &big);
    let cancel = AtomicBool::new(true);
    assert!(matches!(
        apply(&mut lib, &report, &|_| {}, &cancel),
        Err(Error::Cancelled)
    ));
    // The rolled-back import's id is never reused.
    let s = import(&mut lib, &big);
    assert_eq!(s.import_id, 3);
    drop(lib);
    let started: Vec<u64> = events(&f.lib_dir)
        .iter()
        .filter_map(|e| match e {
            Event::ImportStarted { import_id, .. } => Some(*import_id),
            _ => None,
        })
        .collect();
    assert_eq!(started, vec![1, 2, 3]);
}

/// Throughput check: `cargo test --release -p mail-core --all-features
/// --test import_apply -- --ignored --nocapture`.
#[test]
#[ignore]
fn import_perf_10k() {
    let f = fixture();
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut noise = |n: usize| -> Vec<u8> {
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x >> 24) as u8
            })
            .collect()
    };
    let words = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(30);
    let msgs: Vec<Vec<u8>> = (0..10_000u32)
        .map(|n| {
            MsgBuilder::new()
                .from(&format!("Sender {} <s{}@example.com>", n % 500, n % 500))
                .subject(&format!("perf message {n}"))
                .message_id(Some(&format!("<p{n}@fixture>")))
                .thrid(5000 + (n / 3) as u64)
                .labels(&["Inbox", "Perf"])
                .text(&format!("{words} {n}"))
                .attach("blob.bin", "application/octet-stream", &noise(20_000))
                .build()
        })
        .collect();
    let dir = f.src.join("full");
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join(FULL);
    std::fs::write(&p, mbox_of(&msgs)).unwrap();
    let mb = std::fs::metadata(&p).unwrap().len() as f64 / 1e6;
    drop(msgs);

    let mut lib = Library::open(&f.lib_dir).unwrap();
    let t = std::time::Instant::now();
    let report = scan_of(&lib, &p);
    let scan_s = t.elapsed().as_secs_f64();
    let t = std::time::Instant::now();
    let s = apply(&mut lib, &report, &|_| {}, &no_cancel()).unwrap();
    let apply_s = t.elapsed().as_secs_f64();
    println!(
        "{mb:.0} MB, {} msgs: scan {scan_s:.2}s ({:.0} MB/s), apply {apply_s:.2}s ({:.0} MB/s)",
        s.added,
        mb / scan_s,
        mb / apply_s
    );
    assert_eq!(s.added, 10_000);
    assert_eq!(search(&lib, "perf").total_messages, 10_000);
}
