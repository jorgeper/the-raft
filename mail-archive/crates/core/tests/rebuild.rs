use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use mail_core::events::{Event, read_events};
use mail_core::import::apply::{CrashPoint, TestHooks, apply_with_hooks};
use mail_core::import::scan::scan;
use mail_core::library::{Library, SuggestKind};
use mail_core::testing::{MsgBuilder, mbox_of, zip_of};
use tempfile::TempDir;

const FULL: &str = "All mail Including Spam and Trash.mbox";
const NOW: i64 = 1_800_000_000;

fn m(n: u32, labels: &[&str]) -> Vec<u8> {
    MsgBuilder::new()
        .from(&format!("Sender {n} <sender{n}@example.com>"))
        .subject(&format!("subject{n} topic"))
        .date_rfc2822(&format!("Mon, {:02} Nov 2026 10:00:00 +0000", n + 1))
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
        .date_rfc2822("Mon, 20 Nov 2026 10:00:00 +0000")
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
    let mut lib = Library::open(&tmp.join("lib")).unwrap();
    import(&mut lib, &za);
    import(&mut lib, &za2);
    import(&mut lib, &zp);
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

    // Import 4 crashes while finalizing and is rolled back on reopen.
    let a3 = vec![m(1, &["Inbox", "Starred", "Extra"]), m(10, &["Inbox"])];
    let z = zip_to(tmp.path(), "a3.zip", FULL, &a3);
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
    assert_eq!(ids, vec![1, 2, 3, 4, 5]);
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
