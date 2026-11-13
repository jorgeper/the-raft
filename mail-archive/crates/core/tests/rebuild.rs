use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use mail_core::events::EventLog;
use mail_core::events::{Event, read_events};
use mail_core::import::apply::{CrashPoint, TestHooks, apply_with_hooks};
use mail_core::import::scan::scan;
use mail_core::library::{Library, SuggestKind};
use mail_core::model::{ImportKind, MessageRef};
use mail_core::store::Store;
use mail_core::testing::{MsgBuilder, mbox_of, zip_of};
use tempfile::TempDir;

const FULL: &str = "All mail Including Spam and Trash.mbox";
const NOW: i64 = 1_800_000_000;

fn m(n: u32, labels: &[&str]) -> Vec<u8> {
    MsgBuilder::new()
        .from(&format!("Sender {n} <sender{n}@example.com>"))
        .subject(&format!("subject{n} topic"))
        .date_rfc2822(&format!("Mon, {:02} Nov 2025 10:00:00 +0000", n + 1))
        .message_id(Some(&format!("<m{n}@fixture>")))
        .thrid(1000 + u64::from(n % 4))
        .labels(labels)
        .text(&format!("body of message {n} word{n}"))
        .build()
}

/// No Gmail thread id: joins the thread of the message it replies to.
fn reply_to(n: u32) -> Vec<u8> {
    MsgBuilder::new()
        .from("Replier <replier@example.com>")
        .subject("Re: subject1 topic")
        .date_rfc2822("Mon, 20 Nov 2025 10:00:00 +0000")
        .message_id(Some("<reply@fixture>"))
        .raw_header("In-Reply-To", &format!("<m{n}@fixture>"))
        .labels(&["Inbox"])
        .text("a reply without thread id")
        .build()
}

fn orphan() -> Vec<u8> {
    MsgBuilder::new()
        .from("loner@example.com")
        .subject("orphan zebra")
        .message_id(Some("<orphan@fixture>"))
        .labels(&["Sent"])
        .attach("note.txt", "text/plain", b"hello")
        .text("no thread id, no parent")
        .build()
}

fn zip_to(dir: &Path, name: &str, entry: &str, msgs: &[Vec<u8>]) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, zip_of(&format!("Takeout/Mail/{entry}"), &mbox_of(msgs))).unwrap();
    p
}

fn no_cancel() -> AtomicBool {
    AtomicBool::new(false)
}

fn import(lib: &mut Library, p: &Path) {
    lib.import(&[p.to_path_buf()], &|_| {}, &no_cancel())
        .unwrap();
}

/// A, then A' (relabels, removals, additions), then a partial import.
fn build(tmp: &Path) -> Library {
    let a = vec![
        m(1, &["Inbox"]),
        m(2, &["Inbox", "Work"]),
        m(3, &["Spam"]),
        m(4, &["Trash"]),
        m(5, &["Inbox"]),
        m(6, &["Inbox"]),
        reply_to(1),
        orphan(),
    ];
    let a2 = vec![
        m(1, &["Inbox", "Starred"]),
        m(2, &["Inbox"]),
        m(3, &["Spam"]),
        m(4, &["Trash"]),
        m(7, &["Inbox", "Work"]),
        reply_to(1),
        orphan(),
    ];
    let part = vec![m(8, &["Inbox", "Receipts"])];
    let za = zip_to(tmp, "a.zip", FULL, &a);
    let za2 = zip_to(tmp, "a2.zip", FULL, &a2);
    let zp = zip_to(tmp, "p.zip", "Work.mbox", &part);
    // A Full import after the Partial; it lacks the Partial's message 8
    // (and 5, 6 stay removed).
    let a3 = vec![
        m(1, &["Inbox", "Starred"]),
        m(2, &["Inbox", "Work"]),
        m(3, &["Spam"]),
        m(4, &["Trash"]),
        m(7, &["Inbox", "Work"]),
        reply_to(1),
        orphan(),
    ];
    let za3 = zip_to(tmp, "a3.zip", FULL, &a3);
    let mut lib = Library::open(&tmp.join("lib")).unwrap();
    import(&mut lib, &za);
    import(&mut lib, &za2);
    import(&mut lib, &zp);
    import(&mut lib, &za3);
    lib
}

const QUERIES: &[&str] = &[
    "",
    "is:removed",
    "label:inbox",
    "label:starred",
    "label:work",
    "label:receipts",
    "in:spam",
    "in:trash",
    "in:anywhere",
    "from:sender1",
    "from:replier",
    "subject:orphan",
    "has:attachment",
    "word7",
    "topic",
    "after:2020/01/01",
];

type Snapshot = (
    u64,
    Vec<String>,
    Vec<(String, Vec<i64>, usize)>,
    Vec<Vec<String>>,
);

fn snapshot(lib: &Library) -> Snapshot {
    let all = lib.search("in:anywhere", 0, 1000, NOW, &Utc).unwrap();
    let mut rows = Vec::new();
    for t in &all.threads {
        for r in lib.thread(t.thrid).unwrap() {
            rows.push(format!(
                "{} id={} thrid={} labels={:?} removed={} first={} last={} date={} att={}",
                r.subject,
                r.id,
                r.thrid,
                r.labels,
                r.removed,
                r.first_seen_import,
                r.last_seen_import,
                r.date,
                r.attachments.len()
            ));
        }
    }
    rows.sort();
    let queries = QUERIES
        .iter()
        .map(|q| {
            let r = lib.search(q, 0, 1000, NOW, &Utc).unwrap();
            let thr: Vec<i64> = r.threads.iter().map(|t| t.thrid).collect();
            (q.to_string(), thr, r.total_messages)
        })
        .collect();
    let mut ac = Vec::new();
    for p in ["", "w", "in", "sen", "re", "zzz"] {
        ac.push(lib.autocomplete(SuggestKind::Label, p).unwrap());
        ac.push(lib.autocomplete(SuggestKind::Address, p).unwrap());
    }
    (lib.count().unwrap(), rows, queries, ac)
}

#[test]
fn rebuild_reproduces_state() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let lib = build(tmp.path());
    let before = snapshot(&lib);
    // The fixture exercises what rebuild must reproduce.
    assert!(before.1.iter().any(|r| r.contains("removed=true")));
    assert!(
        before
            .1
            .iter()
            .any(|r| r.starts_with("subject8") && r.contains("removed=true")),
        "message of the Partial removed by the later Full"
    );
    assert!(before.1.iter().any(|r| r.contains("thrid=-")));
    assert!(before.2.iter().filter(|q| q.2 > 0).count() >= 10);
    assert!(before.3.iter().any(|a| !a.is_empty()));
    drop(lib);

    std::fs::remove_file(dir.join("meta.sqlite")).unwrap();
    std::fs::remove_dir_all(dir.join("index")).unwrap();
    let mut lib = Library::open(&dir).unwrap();
    assert!(lib.needs_rebuild(), "log has imports SQLite does not know");
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert!(!lib.needs_rebuild());
    assert_eq!(snapshot(&lib), before);
    drop(lib);

    // Persisted, not just in memory; nothing left behind.
    let lib = Library::open(&dir).unwrap();
    assert!(!lib.needs_rebuild());
    assert_eq!(snapshot(&lib), before);
    for leftover in [
        "meta.sqlite.rebuild",
        "meta.sqlite.old",
        "index.rebuild",
        "index.old",
    ] {
        assert!(!dir.join(leftover).exists(), "{leftover}");
    }
}

#[test]
fn rebuild_over_live_state_and_new_import_after() {
    let tmp = TempDir::new().unwrap();
    let mut lib = build(tmp.path());
    let before = snapshot(&lib);
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(snapshot(&lib), before);
    let z = zip_to(tmp.path(), "n.zip", "More.mbox", &[m(9, &["Inbox"])]);
    import(&mut lib, &z);
    assert_eq!(lib.count().unwrap(), before.0 + 1);
}

#[test]
fn rebuild_after_schema_bump() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let lib = build(tmp.path());
    let before = snapshot(&lib);
    drop(lib);
    std::fs::write(dir.join("index/VERSION"), "0").unwrap();
    let mut lib = Library::open(&dir).unwrap();
    assert!(lib.needs_rebuild());
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert!(!lib.needs_rebuild());
    assert_eq!(snapshot(&lib), before);
    drop(lib);
    assert!(!Library::open(&dir).unwrap().needs_rebuild());
}

#[test]
fn rebuild_cancel_keeps_old() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let mut lib = build(tmp.path());
    let before = snapshot(&lib);
    let cancel = AtomicBool::new(false);
    let calls = std::cell::Cell::new(0);
    let r = lib.rebuild(
        &|_| {
            calls.set(calls.get() + 1);
            cancel.store(true, Ordering::Relaxed);
        },
        &cancel,
    );
    assert!(matches!(r, Err(mail_core::Error::Cancelled)), "{r:?}");
    assert!(calls.get() >= 1);
    for leftover in ["meta.sqlite.rebuild", "index.rebuild"] {
        assert!(!dir.join(leftover).exists(), "{leftover}");
    }
    assert_eq!(snapshot(&lib), before, "old state still live and usable");
    // And a later rebuild works.
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(snapshot(&lib), before);
}

#[test]
fn leftover_rebuild_files_are_deleted_on_open() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    drop(build(tmp.path()));
    std::fs::write(dir.join("meta.sqlite.rebuild"), b"partial").unwrap();
    std::fs::write(dir.join("meta.sqlite.rebuild-wal"), b"partial").unwrap();
    std::fs::create_dir_all(dir.join("index.rebuild")).unwrap();
    std::fs::write(dir.join("index.rebuild/junk"), b"x").unwrap();
    let lib = Library::open(&dir).unwrap();
    assert!(!lib.needs_rebuild());
    assert!(!dir.join("meta.sqlite.rebuild").exists());
    assert!(!dir.join("meta.sqlite.rebuild-wal").exists());
    assert!(!dir.join("index.rebuild").exists());
}

#[test]
fn interrupted_swap_is_rolled_back_or_completed_on_open() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let lib = build(tmp.path());
    let before = snapshot(&lib);
    drop(lib);

    // Crash after step 1: live files moved aside, new ones not in place.
    std::fs::rename(dir.join("meta.sqlite"), dir.join("meta.sqlite.old")).unwrap();
    std::fs::rename(dir.join("index"), dir.join("index.old")).unwrap();
    std::fs::write(dir.join("meta.sqlite.rebuild"), b"new").unwrap();
    std::fs::create_dir_all(dir.join("index.rebuild")).unwrap();
    let lib = Library::open(&dir).unwrap();
    assert_eq!(snapshot(&lib), before);
    assert!(!dir.join("meta.sqlite.rebuild").exists());
    drop(lib);

    // Crash between the two step-2 renames: new meta live, index still old.
    std::fs::rename(dir.join("meta.sqlite"), dir.join("meta.sqlite.old")).unwrap();
    std::fs::rename(dir.join("index"), dir.join("index.old")).unwrap();
    std::fs::write(dir.join("meta.sqlite"), b"new, different").unwrap();
    let lib = Library::open(&dir).unwrap();
    assert_eq!(snapshot(&lib), before);
    drop(lib);

    // Crash after step 2: both live, `.old` left over.
    std::fs::create_dir_all(dir.join("index.old")).unwrap();
    std::fs::write(dir.join("meta.sqlite.old"), b"old").unwrap();
    std::fs::write(dir.join("NEEDS_REBUILD"), b"").unwrap();
    let lib = Library::open(&dir).unwrap();
    assert_eq!(snapshot(&lib), before);
    assert!(!dir.join("meta.sqlite.old").exists());
    assert!(!dir.join("index.old").exists());
    assert!(!lib.needs_rebuild());
}

#[test]
fn rebuild_skips_rolled_back_imports_and_ids_are_never_reused() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let mut lib = build(tmp.path());
    let before = snapshot(&lib);

    // Import 5 crashes while finalizing and is rolled back on reopen.
    let a4 = vec![m(1, &["Inbox", "Starred", "Extra"]), m(10, &["Inbox"])];
    let z = zip_to(tmp.path(), "a4.zip", FULL, &a4);
    let report = scan(&lib, &[z], &|_| {}, &no_cancel()).unwrap();
    let hooks = TestHooks {
        batch: None,
        crash: Some(CrashPoint::Finalizing),
    };
    assert!(apply_with_hooks(&mut lib, &report, &|_| {}, &no_cancel(), hooks).is_err());
    drop(lib);
    let mut lib = Library::open(&dir).unwrap();
    assert!(lib.needs_rebuild());
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert!(!lib.needs_rebuild());
    assert_eq!(snapshot(&lib), before, "rolled-back import left no trace");

    // The next import id is above every id in the log, rolled back or not.
    let z = zip_to(tmp.path(), "n.zip", "More.mbox", &[m(11, &["Inbox"])]);
    import(&mut lib, &z);
    let ids: Vec<u64> = read_events(&dir.join("events.log"))
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            Event::ImportStarted { import_id, .. } => Some(*import_id),
            _ => None,
        })
        .collect();
    assert_eq!(ids, vec![1, 2, 3, 4, 5, 6]);
}

#[test]
fn open_flags_rebuild_when_completed_import_has_no_sqlite_row() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    drop(build(tmp.path()));
    std::fs::remove_file(dir.join("meta.sqlite")).unwrap();
    std::fs::remove_dir_all(dir.join("index")).unwrap();
    let lib = Library::open(&dir).unwrap();
    assert!(lib.needs_rebuild());
    assert_eq!(lib.count().unwrap(), 0);
}

fn is_0600(dir: &Path) -> Vec<String> {
    use std::os::unix::fs::PermissionsExt;
    let mut bad = Vec::new();
    for e in std::fs::read_dir(dir).unwrap() {
        let e = e.unwrap();
        if e.file_type().unwrap().is_file() {
            let mode = e.metadata().unwrap().permissions().mode() & 0o777;
            if mode != 0o600 {
                bad.push(format!("{:?} {mode:o}", e.path()));
            }
        }
    }
    bad
}

#[test]
fn rebuilt_index_files_are_private() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let mut lib = build(tmp.path());
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(is_0600(&dir.join("index")), Vec::<String>::new());
    drop(lib);
    // Also after opening a Ready index whose files were loosened.
    use std::os::unix::fs::PermissionsExt;
    for e in std::fs::read_dir(dir.join("index")).unwrap() {
        let p = e.unwrap().path();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    drop(Library::open(&dir).unwrap());
    assert_eq!(is_0600(&dir.join("index")), Vec::<String>::new());
}

/// An mbox whose `From ` lines carry the given dates (`Day Mon dd hh:mm:ss +0000 yyyy`).
fn mbox_with_from_dates(msgs: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (date, msg) in msgs {
        out.extend_from_slice(format!("From 1@xxx {date}\n").as_bytes());
        out.extend_from_slice(msg);
        if !msg.ends_with(b"\n") {
            out.push(b'\n');
        }
        out.push(b'\n');
    }
    out
}

#[test]
fn dateless_message_keeps_its_from_line_date() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let dateless = |n: u32| {
        MsgBuilder::new()
            .from("nodate@example.com")
            .subject(&format!("nodate{n}"))
            .no_date()
            .message_id(Some(&format!("<nodate{n}@fixture>")))
            .thrid(500 + u64::from(n))
            .labels(&["Inbox"])
            .text("no date header here")
            .build()
    };
    let mbox = mbox_with_from_dates(&[
        ("Mon Jan 05 10:00:00 +0000 2026", dateless(1)),
        ("Sat Mar 14 10:00:00 +0000 2026", dateless(2)),
    ]);
    let z = tmp.path().join("nd.zip");
    std::fs::write(&z, zip_of("Takeout/Mail/Work.mbox", &mbox)).unwrap();
    let mut lib = Library::open(&dir).unwrap();
    import(&mut lib, &z);
    let q = |lib: &Library, s: &str| {
        lib.search(s, 0, 100, NOW, &Utc)
            .unwrap()
            .threads
            .iter()
            .map(|t| t.subject.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(q(&lib, "after:2026/02/01"), vec!["nodate2"]);
    assert_eq!(q(&lib, "before:2026/02/01"), vec!["nodate1"]);
    let before = snapshot(&lib);
    assert!(
        before.1.iter().any(|r| r.contains("date=1767607200")),
        "{:?}",
        before.1
    );
    drop(lib);

    let mut lib = Library::open(&dir).unwrap();
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(snapshot(&lib), before);
    assert_eq!(q(&lib, "after:2026/02/01"), vec!["nodate2"]);
    assert_eq!(q(&lib, "before:2026/02/01"), vec!["nodate1"]);
}

#[test]
fn missing_row_detected_after_cancelled_last_import() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let mut lib = build(tmp.path());
    // Cancel the next import once it is under way; it is rolled back.
    let z = zip_to(
        tmp.path(),
        "c.zip",
        "More.mbox",
        &(20..30).map(|n| m(n, &["Inbox"])).collect::<Vec<_>>(),
    );
    let report = scan(&lib, &[z], &|_| {}, &no_cancel()).unwrap();
    let cancel = AtomicBool::new(false);
    let hooks = TestHooks {
        batch: Some(1),
        crash: None,
    };
    let r = apply_with_hooks(
        &mut lib,
        &report,
        &|p| {
            if p.phase == "import" {
                cancel.store(true, Ordering::Relaxed);
            }
        },
        &cancel,
        hooks,
    );
    assert!(matches!(r, Err(mail_core::Error::Cancelled)), "{r:?}");
    let events = read_events(&dir.join("events.log")).unwrap();
    assert!(matches!(
        events.last(),
        Some(Event::ImportRolledBack { .. })
    ));
    drop(lib);
    assert!(!Library::open(&dir).unwrap().needs_rebuild());

    std::fs::remove_file(dir.join("meta.sqlite")).unwrap();
    let lib = Library::open(&dir).unwrap();
    assert!(
        lib.needs_rebuild(),
        "log tail is a rollback, SQLite is empty"
    );
}

/// Many small imports: every rebuild commit adds a segment, so merges run.
fn many_small_imports(tmp: &Path, n: u32) -> Library {
    let mut lib = Library::open(&tmp.join("lib")).unwrap();
    for i in 0..n {
        // Distinct dates: thread order must not depend on tie-breaking.
        let msgs: Vec<_> = (0..3)
            .map(|j| {
                let n = i * 3 + j;
                MsgBuilder::new()
                    .from(&format!("Sender {n} <sender{n}@example.com>"))
                    .subject(&format!("subject{n} topic"))
                    .date_rfc2822(&format!(
                        "Mon, 02 Nov 2026 {:02}:{:02}:00 +0000",
                        n / 60,
                        n % 60
                    ))
                    .message_id(Some(&format!("<s{n}@fixture>")))
                    .thrid(1000 + u64::from(n % 4))
                    .labels(&["Inbox"])
                    .text(&format!("body {n}"))
                    .build()
            })
            .collect();
        let z = zip_to(tmp, &format!("s{i}.zip"), &format!("L{i}.mbox"), &msgs);
        import(&mut lib, &z);
    }
    lib
}

#[test]
fn cancel_during_merges_then_retry_immediately() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let mut lib = many_small_imports(tmp.path(), 14);
    let before = snapshot(&lib);
    for round in 0..2 {
        let cancel = AtomicBool::new(false);
        let calls = std::cell::Cell::new(0);
        let r = lib.rebuild(
            &|_| {
                calls.set(calls.get() + 1);
                if calls.get() >= 10 {
                    cancel.store(true, Ordering::Relaxed);
                }
            },
            &cancel,
        );
        assert!(
            matches!(r, Err(mail_core::Error::Cancelled)),
            "{round}: {r:?}"
        );
        assert!(!dir.join("index.rebuild").exists());
        assert!(!dir.join("meta.sqlite.rebuild").exists());
    }
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(snapshot(&lib), before);
    assert_eq!(is_0600(&dir.join("index")), Vec::<String>::new());
}

#[test]
fn crash_after_only_meta_step_one_rolls_back() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let lib = build(tmp.path());
    let before = snapshot(&lib);
    drop(lib);
    // Swap step 1 renamed only meta.sqlite; the index is untouched.
    std::fs::rename(dir.join("meta.sqlite"), dir.join("meta.sqlite.old")).unwrap();
    std::fs::write(dir.join("meta.sqlite.rebuild"), b"new").unwrap();
    std::fs::create_dir_all(dir.join("index.rebuild")).unwrap();
    let lib = Library::open(&dir).unwrap();
    assert_eq!(snapshot(&lib), before);
    assert!(!lib.needs_rebuild());
    for leftover in [
        "meta.sqlite.rebuild",
        "meta.sqlite.old",
        "index.rebuild",
        "index.old",
    ] {
        assert!(!dir.join(leftover).exists(), "{leftover}");
    }
}

#[test]
fn unreadable_message_and_log_inconsistencies_do_not_abort_rebuild() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let lib = build(tmp.path());
    let count = lib.count().unwrap();
    drop(lib);
    // Append a completed Full import by hand: one garbage message, one
    // relabel of a message that does not exist, one unknown removed key.
    let mut store = Store::open(&dir).unwrap();
    let bad: MessageRef = store.append(b"\x00\x01 not a message\n").unwrap();
    store.sync().unwrap();
    let mut log = EventLog::open(&dir.join("events.log")).unwrap();
    let key = |n: u8| [n; 32];
    for e in [
        Event::ImportStarted {
            import_id: 50,
            at: 1,
            source: "hand".into(),
            kind: ImportKind::Full,
        },
        Event::MessageAdded {
            import_id: 50,
            content_key: key(7),
            header_key: None,
            msg_ref: bad,
            labels: vec!["Inbox".into()],
            from_line_date: None,
        },
        Event::LabelsChanged {
            import_id: 50,
            content_key: key(8),
            labels: vec!["X".into()],
        },
        Event::ImportCompleted {
            import_id: 50,
            at: 2,
            removed: vec![key(7), key(9)],
        },
    ] {
        log.append(&e).unwrap();
    }
    log.sync().unwrap();
    drop(log);
    drop(store);

    let mut lib = Library::open(&dir).unwrap();
    assert!(lib.needs_rebuild());
    let seen = std::cell::Cell::new(0);
    let s = lib
        .rebuild(&|p| seen.set(seen.get().max(p.errors)), &no_cancel())
        .unwrap();
    assert_eq!(s.parse_errors, 1);
    // LabelsChanged(8), removed 7 (skipped message) and 9.
    assert_eq!(s.inconsistencies, 3);
    assert_eq!(seen.get(), 1, "progress reports the skipped message");
    assert_eq!(lib.count().unwrap(), count);
    assert!(!lib.needs_rebuild());
}

/// The library's single row for `word`, and its msg ref.
fn only_row(lib: &Library, word: &str) -> (i64, MessageRef) {
    let r = lib.search(word, 0, 10, NOW, &Utc).unwrap();
    assert_eq!(r.total_messages, 1, "{word}");
    let id = r.threads[0].matched[0];
    (id, lib.message(id).unwrap().msg_ref)
}

/// Overwrite the start of a stored frame (its zstd magic); returns the old bytes.
fn clobber_frame(dir: &Path, r: MessageRef) -> Vec<u8> {
    use std::os::unix::fs::FileExt;
    let pack = dir.join(format!("store/pack-{:05}.zst", r.pack_id));
    let f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(pack)
        .unwrap();
    let mut old = vec![0u8; 4];
    f.read_exact_at(&mut old, r.offset).unwrap();
    f.write_all_at(&[0; 4], r.offset).unwrap();
    old
}

fn restore_frame(dir: &Path, r: MessageRef, old: &[u8]) {
    use std::os::unix::fs::FileExt;
    let pack = dir.join(format!("store/pack-{:05}.zst", r.pack_id));
    let f = std::fs::OpenOptions::new().write(true).open(pack).unwrap();
    f.write_all_at(old, r.offset).unwrap();
}

/// A rebuild skips a message (its frame was unreadable at the time), the next
/// import adds it again, and so the log holds two MessageAdded events with
/// one content key. Later rebuilds keep one row for it instead of failing on
/// the UNIQUE content key.
#[test]
fn a_message_skipped_by_rebuild_and_imported_again_keeps_one_row() {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let z = zip_to(
        tmp.path(),
        "a.zip",
        FULL,
        &[m(1, &["Inbox"]), m(2, &["Inbox"])],
    );
    let mut lib = Library::open(&dir).unwrap();
    import(&mut lib, &z);
    let (_, first_copy) = only_row(&lib, "word2");

    // Rebuild while message 2's frame cannot be decoded: it is skipped.
    let saved = clobber_frame(&dir, first_copy);
    let s = lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(s.parse_errors, 1);
    assert_eq!(lib.count().unwrap(), 1);
    // The frame is fine again; a re-import adds message 2 a second time.
    restore_frame(&dir, first_copy, &saved);
    let added = lib
        .import(std::slice::from_ref(&z), &|_| {}, &no_cancel())
        .unwrap()
        .added;
    assert_eq!(added, 1);
    let (_, second_copy) = only_row(&lib, "word2");
    assert_ne!(first_copy, second_copy);

    // Both copies readable: the first one wins, the second is an inconsistency.
    let s = lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!((s.parse_errors, s.inconsistencies), (0, 1));
    assert_eq!(lib.count().unwrap(), 2);
    assert_eq!(only_row(&lib, "word2").1, first_copy);
    assert!(!lib.needs_rebuild());

    // First copy unreadable: the second one is used, still one row.
    clobber_frame(&dir, first_copy);
    let s = lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(s.parse_errors, 1);
    assert_eq!(lib.count().unwrap(), 2);
    assert_eq!(only_row(&lib, "word2").1, second_copy);
}

/// A pack file that cannot be read (here: no permission) is an I/O failure,
/// not a corrupt message: the rebuild stops and the old caches stay live,
/// instead of swapping in a library with those messages missing.
#[test]
fn rebuild_aborts_when_the_store_cannot_be_read() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("lib");
    let mut lib = build(tmp.path());
    let before = snapshot(&lib);
    let pack = dir.join("store/pack-00000.zst");
    std::fs::set_permissions(&pack, std::fs::Permissions::from_mode(0o000)).unwrap();
    let r = lib.rebuild(&|_| {}, &no_cancel());
    std::fs::set_permissions(&pack, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(r.is_err(), "rebuild must fail, got {r:?}");
    assert_eq!(snapshot(&lib), before);
    assert!(!dir.join("meta.sqlite.rebuild").exists());
    // Once the store is readable again, the rebuild goes through.
    lib.rebuild(&|_| {}, &no_cancel()).unwrap();
    assert_eq!(snapshot(&lib), before);
}
