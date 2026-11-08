mod common;

use std::time::Instant;

use chrono::FixedOffset;
use chrono_tz::America::Los_Angeles;
use common::{TestMsg, build_library, build_library_with};
use mail_core::Error;
use mail_core::library::{Library, SearchResults, SuggestKind};
use mail_core::testing::MsgBuilder;
use tempfile::TempDir;

const NOW: i64 = 1_592_179_200; // 2020-06-15 00:00:00 UTC

fn msg(
    from: &str,
    subject: &str,
    date: &str,
    thrid: u64,
    labels: &[&str],
    body: &str,
) -> MsgBuilder {
    MsgBuilder::new()
        .from(from)
        .subject(subject)
        .date_rfc2822(&format!("{date} +0000"))
        .message_id(Some(&format!(
            "<{thrid}.{}@fixture>",
            format!("{subject}{date}").replace(|c: char| !c.is_alphanumeric(), "_")
        )))
        .thrid(thrid)
        .labels(labels)
        .text(body)
}

fn fixture() -> Vec<Vec<u8>> {
    let mut v = vec![
        msg(
            "alice@example.com",
            "Quarterly report",
            "01 Mar 2020 10:00:00",
            1,
            &["Inbox"],
            "revenue numbers attached",
        )
        .to("bob@corp.com")
        .attach("report.pdf", "application/pdf", b"%PDF-fake")
        .build(),
        msg(
            "Bob Jones <bob@corp.com>",
            "Re: Quarterly report",
            "02 Mar 2020 10:00:00",
            1,
            &["Inbox"],
            "thanks looks fine",
        )
        .to("alice@example.com")
        .build(),
        msg(
            "alice@example.com",
            "Re: Quarterly report",
            "03 Mar 2020 10:00:00",
            1,
            &["Sent"],
            "revenue update",
        )
        .to("bob@corp.com")
        .build(),
        msg(
            "Amazon Orders <orders@amazon.com>",
            "Your order shipped",
            "01 Apr 2020 10:00:00",
            2,
            &["Inbox", "Category Purchases"],
            "your parcel is on its way",
        )
        .build(),
        msg(
            "carol@school.edu",
            "Lunch plans",
            "01 May 2020 10:00:00",
            3,
            &["Inbox", "Starred"],
            "pizza on friday",
        )
        .to("dave@home.net")
        .cc("erin@home.net")
        .build(),
        msg(
            "spammer@bad.biz",
            "Win money",
            "01 Jul 2020 10:00:00",
            4,
            &["Spam"],
            "pizza coupon inside",
        )
        .build(),
        msg(
            "frank@old.org",
            "Old stuff",
            "02 Jul 2020 10:00:00",
            5,
            &["Trash"],
            "discarded notes",
        )
        .build(),
        msg(
            "dave@home.net",
            "Receipts",
            "01 Jun 2019 10:00:00",
            6,
            &["Receipts 2019"],
            "tax paperwork",
        )
        .build(),
        msg(
            "grace@x.org",
            "Boundary",
            "01 Jan 2020 08:30:00",
            7,
            &["Inbox"],
            "new year",
        )
        .build(),
        msg(
            "heidi@x.org",
            "Big file",
            "10 Feb 2020 10:00:00",
            8,
            &["Inbox"],
            &"x ".repeat(8000),
        )
        .attach("big.zip", "application/zip", &[7u8; 4000])
        .build(),
        msg(
            "ivan@x.org",
            "Unread note",
            "01 Jun 2020 10:00:00",
            9,
            &["Inbox", "Unread", "Important"],
            "please read",
        )
        .raw_header("Bcc", "frank@hidden.net")
        .build(),
    ];
    for i in 0..19u64 {
        v.push(
            msg(
                "filler@x.org",
                &format!("Filler {i}"),
                &format!("{:02} Jan 2018 10:00:00", i + 1),
                100 + i,
                &["Inbox"],
                "nothing to see",
            )
            .build(),
        );
    }
    v
}

fn lib() -> (TempDir, Library) {
    let d = tempfile::tempdir().unwrap();
    let l = build_library(&d.path().join("lib"), &fixture());
    (d, l)
}

fn utc() -> FixedOffset {
    FixedOffset::east_opt(0).unwrap()
}

fn run(l: &Library, q: &str) -> SearchResults {
    l.search(q, 0, 100, NOW, &utc()).unwrap()
}

fn set(l: &Library, q: &str) -> Vec<i64> {
    let mut v: Vec<i64> = run(l, q).threads.iter().map(|t| t.thrid).collect();
    v.sort();
    v
}

#[test]
fn operators_filter() {
    let (_d, l) = lib();
    let cases: &[(&str, &[i64])] = &[
        ("from:alice", &[1]),
        ("from:amazon.com", &[2]),
        ("from:\"Amazon Orders\"", &[2]),
        ("to:dave", &[3]),
        ("cc:erin", &[3]),
        ("bcc:frank", &[9]),
        ("subject:quarterly", &[1]),
        ("subject:\"order shipped\"", &[2]),
        ("revenue", &[1]),
        ("pizza", &[3]),
        ("\"revenue numbers\"", &[1]),
        ("\"numbers revenue\"", &[]),
        ("revenue update", &[1]),
        ("revenue numbers update", &[]),
        ("revenue -update", &[1]),
        ("pizza OR revenue", &[1, 3]),
        ("{pizza revenue}", &[1, 3]),
        ("label:receipts-2019", &[6]),
        ("label:\"Receipts 2019\"", &[6]),
        ("label:starred", &[3]),
        ("is:starred", &[3]),
        ("is:unread", &[9]),
        ("is:important", &[9]),
        ("in:sent", &[1]),
        ("in:inbox subject:boundary", &[7]),
        ("category:purchases", &[2]),
        ("has:attachment", &[1, 8]),
        ("filename:report", &[1]),
        ("filename:report.pdf", &[1]),
        ("after:2020/05/01", &[3, 9]),
        ("after:2020/05/02", &[9]),
        ("before:2018/01/03", &[100, 101]),
        ("older_than:1y after:2019/01/01", &[6]),
        ("newer_than:30d", &[9]),
        ("larger:10000", &[8]),
        ("smaller:10000 subject:big", &[]),
        ("smaller:10000 subject:quarterly", &[1]),
        ("larger:9K", &[8]),
        ("larger:1M", &[]),
        ("smaller:1M subject:big", &[8]),
        ("smaller:1K subject:big", &[]),
        ("subject:lunch (revenue OR pizza)", &[3]),
        ("subject:quarterly (revenue OR pizza)", &[1]),
        ("subject:quarterly (pizza OR boundary)", &[]),
        ("older_than:2m after:2020/03/15", &[2]),
        ("newer_than:2m", &[3, 9]),
        ("older_than:1m after:2020/05/02", &[]),
        ("pizza -in:trash", &[3]),
        ("-in:spam pizza", &[3]),
        ("in:spam discarded", &[]),
        ("in:trash pizza", &[]),
        ("in:anywhere subject:win", &[4]),
        ("in:anywhere subject:old", &[5]),
        ("-from:alice subject:quarterly", &[1]),
        (
            "-label:inbox -label:sent -label:receipts-2019 -label:starred after:2000/01/01",
            &[],
        ),
    ];
    for (q, want) in cases {
        assert_eq!(set(&l, q), *want, "query {q:?}");
    }
}

#[test]
fn negation_only_matches_everything_else() {
    let (_d, l) = lib();
    let all = set(&l, "");
    let not_pizza = set(&l, "-pizza");
    assert_eq!(not_pizza.len(), all.len() - 1);
    assert!(!not_pizza.contains(&3));
}

#[test]
fn spam_trash_excluded_by_default() {
    let (_d, l) = lib();
    assert_eq!(set(&l, "pizza"), [3]);
    assert_eq!(set(&l, "pizza in:spam"), [4]);
    assert_eq!(set(&l, "pizza in:anywhere"), [3, 4]);
    assert_eq!(set(&l, "in:trash"), [5]);
    // A positive location lifts only its own exclusion.
    assert_eq!(set(&l, "in:spam"), [4]);
    assert!(set(&l, "in:spam discarded").is_empty());
    assert!(set(&l, "pizza -in:trash") == [3]);
    assert_eq!(set(&l, "in:spam OR in:trash"), [4, 5]);
    assert_eq!(set(&l, "discarded in:anywhere"), [5]);
    assert!(set(&l, "discarded").is_empty());
}

#[test]
fn before_is_exclusive() {
    let (_d, l) = lib();
    let tz = FixedOffset::west_opt(8 * 3600).unwrap(); // message is 2020-01-01 00:30 local
    let q = |q: &str| -> Vec<i64> {
        l.search(q, 0, 10, NOW, &tz)
            .unwrap()
            .threads
            .iter()
            .map(|t| t.thrid)
            .collect()
    };
    assert!(q("subject:boundary before:2020/01/01").is_empty());
    assert_eq!(q("subject:boundary after:2019/12/31"), [7]);
    assert_eq!(q("subject:boundary after:2020/01/01"), [7]);
    assert_eq!(q("subject:boundary before:2020/01/02"), [7]);
    assert!(q("subject:boundary after:2020/01/02").is_empty());
}

#[test]
fn grouped_by_thread_newest_first() {
    let (_d, l) = lib();
    let r = run(&l, "quarterly");
    assert_eq!(r.threads.len(), 1);
    assert_eq!(r.total_messages, 3);
    let t = &r.threads[0];
    assert_eq!(t.thrid, 1);
    assert_eq!(t.message_count, 3);
    assert_eq!(t.matched.len(), 3);
    assert_eq!(t.subject, "Re: Quarterly report");
    assert!(t.has_attachment);
    assert_eq!(t.senders, ["alice@example.com", "Bob Jones"]);
    assert_eq!(t.latest_date, 1_583_229_600); // 2020-03-03 10:00 UTC
}

#[test]
fn message_count_is_thread_size_not_match_count() {
    let (_d, l) = lib();
    let r = run(&l, "revenue");
    assert_eq!(r.threads.len(), 1);
    assert_eq!(r.threads[0].matched.len(), 2);
    assert_eq!(r.threads[0].message_count, 3);
    assert_eq!(r.total_messages, 2);
}

#[test]
fn empty_query_recent_mail() {
    let (_d, l) = lib();
    for q in ["", "   ", "!!!"] {
        let r = run(&l, q);
        assert_eq!(r.threads.len(), 26, "{q:?}");
        let dates: Vec<i64> = r.threads.iter().map(|t| t.latest_date).collect();
        assert!(dates.windows(2).all(|w| w[0] >= w[1]));
        assert_eq!(r.threads[0].thrid, 9);
        assert!(r.threads.iter().all(|t| t.thrid != 4 && t.thrid != 5));
    }
}

#[test]
fn paging() {
    let (_d, l) = lib();
    let ids = |o, n| -> Vec<i64> {
        l.search("", o, n, NOW, &utc())
            .unwrap()
            .threads
            .iter()
            .map(|t| t.thrid)
            .collect()
    };
    let (a, b, all) = (ids(0, 5), ids(5, 5), ids(0, 10));
    assert_eq!(a.len(), 5);
    assert_eq!(b.len(), 5);
    assert!(a.iter().all(|x| !b.contains(x)));
    assert_eq!([a, b].concat(), all);
    assert!(ids(1000, 5).is_empty());
}

#[test]
fn chips_hints_and_timing_reported() {
    let (_d, l) = lib();
    let r = run(&l, "from:alice pizza");
    assert_eq!(r.chips.len(), 1);
    assert_eq!(r.terms, ["pizza"]);
    assert!(r.elapsed_ms >= 0.0);
}

#[test]
fn autocomplete_labels_and_addresses() {
    let (_d, l) = lib();
    assert_eq!(
        l.autocomplete(SuggestKind::Label, "re").unwrap(),
        ["Receipts 2019"]
    );
    let labels = l.autocomplete(SuggestKind::Label, "").unwrap();
    assert!(labels.len() <= 10 && labels.contains(&"Inbox".to_string()));
    assert_eq!(
        l.autocomplete(SuggestKind::Address, "amazon").unwrap(),
        ["Amazon Orders <orders@amazon.com>"]
    );
    assert_eq!(
        l.autocomplete(SuggestKind::Address, "alice").unwrap(),
        ["alice@example.com"]
    );
    assert!(l.autocomplete(SuggestKind::Address, "").unwrap().len() <= 10);
}

#[test]
fn thread_and_raw() {
    let (_d, l) = lib();
    let rows = l.thread(1).unwrap();
    assert_eq!(rows.len(), 3);
    assert!(rows.windows(2).all(|w| w[0].date <= w[1].date));
    let raw = l.raw(rows[0].id).unwrap();
    assert!(String::from_utf8_lossy(&raw).contains("Subject: Quarterly report"));
}

#[test]
fn library_is_locked_while_open() {
    let d = tempfile::tempdir().unwrap();
    let dir = d.path().join("lib");
    let first = Library::open(&dir).unwrap();
    assert!(matches!(Library::open(&dir), Err(Error::LibraryInUse)));
    drop(first);
    Library::open(&dir).unwrap();
}

#[test]
fn needs_rebuild_when_index_missing_or_out_of_sync() {
    let d = tempfile::tempdir().unwrap();
    let dir = d.path().join("lib");
    let l = build_library(&dir, &fixture());
    assert!(!l.needs_rebuild());
    drop(l);
    // A schema/VERSION change wipes the index: reported as needing rebuild.
    std::fs::write(dir.join("index/VERSION"), "0").unwrap();
    assert!(Library::open(&dir).unwrap().needs_rebuild());

    let d2 = tempfile::tempdir().unwrap();
    let dir2 = d2.path().join("lib");
    drop(build_library(&dir2, &fixture()));
    std::fs::remove_dir_all(dir2.join("index")).unwrap();
    assert!(Library::open(&dir2).unwrap().needs_rebuild());
}

fn lcg(s: &mut u64) -> u64 {
    *s = s
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *s >> 33
}

/// Perf smoke test: `cargo test --release -p mail-core --test search -- --ignored --nocapture`
#[test]
#[ignore]
fn perf_smoke_20k_messages() {
    const N: usize = 20_000;
    let mut seed = 42u64;
    let words: Vec<String> = (0..800).map(|i| format!("w{}x{}", i, i * 7 % 13)).collect();
    let labels = [
        "Inbox",
        "Sent",
        "Starred",
        "Unread",
        "Important",
        "Spam",
        "Receipts",
    ];
    let mut msgs = Vec::with_capacity(N);
    for i in 0..N {
        let body: Vec<&str> = (0..60)
            .map(|_| words[lcg(&mut seed) as usize % words.len()].as_str())
            .collect();
        let subj: Vec<&str> = (0..4)
            .map(|_| words[lcg(&mut seed) as usize % words.len()].as_str())
            .collect();
        let day = lcg(&mut seed) % 1500;
        let ts = 1_500_000_000 + day * 86_400;
        let date = chrono_date(ts);
        let sender = lcg(&mut seed) % 400;
        let mut b = msg(
            &format!("Sender {sender} <s{sender}@host{}.com>", sender % 20),
            &subj.join(" "),
            &date,
            (i / 3) as u64 + 1,
            &[
                labels[lcg(&mut seed) as usize % labels.len()],
                labels[lcg(&mut seed) as usize % 3],
            ],
            &body.join(" "),
        )
        .message_id(Some(&format!("<m{i}@perf>")));
        if i % 10 == 0 {
            b = b.attach("doc.pdf", "application/pdf", b"%PDF");
        }
        msgs.push(b.build());
    }
    let d = tempfile::tempdir().unwrap();
    let t = Instant::now();
    let l = build_library(&d.path().join("lib"), &msgs);
    eprintln!("built {N} messages in {:?}", t.elapsed());
    let w = |i: usize| words[i].as_str();
    let queries = [
        w(10).to_string(),
        format!("{} {}", w(10), w(20)),
        "from:s17".to_string(),
        format!("subject:{} label:inbox", w(5)),
        format!("has:attachment {}", w(33)),
        format!("after:2018/01/01 before:2018/06/01 {}", w(44)),
        format!("\"{} {}\"", w(1), w(2)),
        "is:unread".to_string(),
        String::new(),
        format!("in:anywhere {} -label:starred", w(99)),
    ];
    let mut times = Vec::new();
    for q in &queries {
        let r = l.search(q, 0, 50, 1_700_000_000, &utc()).unwrap(); // warm up
        eprintln!(
            "{q:45} {} threads, {} messages",
            r.threads.len(),
            r.total_messages
        );
        for _ in 0..20 {
            let t = Instant::now();
            l.search(q, 0, 50, 1_700_000_000, &utc()).unwrap();
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        eprintln!("{q:45} {:.2} ms", times[times.len() - 1]);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p95 = times[(times.len() as f64 * 0.95) as usize - 1];
    eprintln!(
        "p50 {:.2} ms, p95 {p95:.2} ms, max {:.2} ms",
        times[times.len() / 2],
        times[times.len() - 1]
    );
    if !cfg!(debug_assertions) {
        assert!(p95 < 100.0, "p95 {p95} ms");
    }
}

fn chrono_date(ts: u64) -> String {
    // Civil-from-days (Howard Hinnant), no chrono formatting needed.
    let days = (ts / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    const MON: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!("{d:02} {} {y} 12:00:00", MON[m as usize - 1])
}

#[test]
fn is_removed_matches_only_removed_and_default_still_shows_it() {
    let d = tempfile::tempdir().unwrap();
    let mut msgs: Vec<TestMsg> = fixture().into_iter().map(TestMsg::new).collect();
    msgs.push(TestMsg::removed(
        msg(
            "zed@x.org",
            "Gone from export",
            "05 Jun 2020 10:00:00",
            50,
            &["Inbox"],
            "vanished",
        )
        .build(),
    ));
    let l = build_library_with(&d.path().join("lib"), &msgs);
    assert_eq!(set(&l, "is:removed"), [50]);
    assert_eq!(set(&l, "vanished"), [50]);
    assert_eq!(set(&l, "-is:removed subject:gone"), Vec::<i64>::new());
    assert!(run(&l, "").threads.iter().any(|t| t.thrid == 50));
}

#[test]
fn day_boundaries_follow_dst() {
    let d = tempfile::tempdir().unwrap();
    let msgs = [
        // 2020-07-01 00:30 PDT and 2020-01-15 00:30 PST.
        msg(
            "a@x.org",
            "Summer",
            "01 Jul 2020 07:30:00",
            1,
            &["Inbox"],
            "s",
        )
        .build(),
        msg(
            "a@x.org",
            "Winter",
            "15 Jan 2020 08:30:00",
            2,
            &["Inbox"],
            "w",
        )
        .build(),
    ];
    let l = build_library(&d.path().join("lib"), &msgs);
    let q = |q: &str| -> Vec<i64> {
        l.search(q, 0, 10, NOW, &Los_Angeles)
            .unwrap()
            .threads
            .iter()
            .map(|t| t.thrid)
            .collect()
    };
    assert_eq!(q("subject:summer after:2020/07/01"), [1]);
    assert!(q("subject:summer before:2020/07/01").is_empty());
    assert_eq!(q("subject:winter after:2020/01/15"), [2]);
    assert!(q("subject:winter before:2020/01/15").is_empty());
}

#[test]
fn message_returns_row_and_errors_on_unknown_id() {
    let dir = TempDir::new().unwrap();
    let m = MsgBuilder::new()
        .from("alice@example.com")
        .subject("Hello")
        .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
        .message_id(Some("<m1@fixture>"))
        .thrid(7)
        .attach("a.txt", "text/plain", b"hi")
        .text("body")
        .build();
    let l = build_library(dir.path(), &[m]);
    let id = l.thread(7).unwrap()[0].id;
    let row = l.message(id).unwrap();
    assert_eq!(row.subject, "Hello");
    assert_eq!(row.attachments.len(), 1);
    assert!(l.message(id + 1000).is_err());
}

#[test]
fn install_panic_hook_is_idempotent_and_chains_to_previous_hook() {
    use std::panic::{catch_unwind, set_hook, take_hook};
    use std::sync::{Arc, Mutex};
    // Installing twice must not stack hooks; ordinary panics still reach the
    // previously installed hook.
    let seen = Arc::new(Mutex::new(0u32));
    let s2 = seen.clone();
    let _ = take_hook();
    set_hook(Box::new(move |_| *s2.lock().unwrap() += 1));
    mail_core::import::scan::install_panic_hook();
    mail_core::import::scan::install_panic_hook();
    let _ = catch_unwind(|| panic!("ordinary"));
    assert_eq!(
        *seen.lock().unwrap(),
        1,
        "hook installed twice or lost the previous one"
    );
}

/// `MAX_COLLECTED + 100` messages sharing one date over 60 threads, plus 20
/// newer ones. `work(n)` marks tied message `n` with an extra label.
fn tied_messages(work: impl Fn(usize) -> bool) -> Vec<Vec<u8>> {
    use mail_core::query::exec::MAX_COLLECTED;
    let mut msgs = Vec::new();
    for n in 0..MAX_COLLECTED + 100 {
        let labels: &[&str] = if work(n) {
            &["Inbox", "Work"]
        } else {
            &["Inbox"]
        };
        msgs.push(
            MsgBuilder::new()
                .from(&format!("s{}@example.com", n % 7))
                .subject(&format!("tied {n}"))
                .date_rfc2822("Mon, 02 Mar 2020 10:00:00 +0000")
                .message_id(Some(&format!("<t{n}@fixture>")))
                .thrid(1 + (n as u64 * 7919) % 60)
                .labels(labels)
                .text("tied body")
                .build(),
        );
    }
    for n in 0..20 {
        msgs.push(
            MsgBuilder::new()
                .from("new@example.com")
                .subject(&format!("newer {n}"))
                .date_rfc2822("Tue, 03 Mar 2020 10:00:00 +0000")
                .message_id(Some(&format!("<n{n}@fixture>")))
                .thrid(100 + n as u64 % 3)
                .labels(&["Inbox"])
                .text("newer body")
                .build(),
        );
    }
    msgs
}

fn import_msgs(l: &mut Library, dir: &std::path::Path, name: &str, msgs: &[Vec<u8>]) {
    use std::sync::atomic::AtomicBool;
    let zip = dir.join(name);
    std::fs::write(
        &zip,
        mail_core::testing::zip_of(
            "Takeout/Mail/All mail Including Spam and Trash.mbox",
            &mail_core::testing::mbox_of(msgs),
        ),
    )
    .unwrap();
    l.import(&[zip], &|_| {}, &AtomicBool::new(false)).unwrap();
}

type Snapshot = Vec<(i64, i64, Vec<String>, Vec<i64>)>;

fn snapshot(l: &Library) -> Snapshot {
    l.search("", 0, 10_000, NOW, &utc())
        .unwrap()
        .threads
        .into_iter()
        .map(|t| (t.thrid, t.latest_date, t.senders, t.matched))
        .collect()
}

/// Many messages share one date; the tied group straddles `MAX_COLLECTED`.
/// Results must depend only on library content (date desc, thrid desc,
/// msg id desc), not on index doc order, so a rebuilt library answers
/// identically to the imported one.
#[test]
fn same_date_results_are_deterministic_across_rebuild_and_limit() {
    use mail_core::query::exec::MAX_COLLECTED;
    use std::sync::atomic::AtomicBool;

    let msgs = tied_messages(|_| false);
    let dir = TempDir::new().unwrap();
    let mut l = Library::open(&dir.path().join("lib")).unwrap();
    import_msgs(&mut l, dir.path(), "a.zip", &msgs);
    let before = snapshot(&l);

    // Thread order: latest_date desc, then thrid desc.
    for w in before.windows(2) {
        assert!((w[0].1, w[0].0) > (w[1].1, w[1].0), "thread order");
    }
    // Inside a thread: msg id desc (all but the newest group share a date).
    for t in &before {
        let dates: Vec<_> = t.3.iter().map(|&id| l.message(id).unwrap().date).collect();
        assert!(dates.windows(2).all(|d| d[0] >= d[1]), "date desc");
        for (i, w) in t.3.windows(2).enumerate() {
            if dates[i] == dates[i + 1] {
                assert!(w[0] > w[1], "msg id desc within tie");
            }
        }
    }
    // The kept set is exactly the top MAX_COLLECTED by (date, thrid, id).
    let mut all: Vec<(i64, i64, i64)> = (1..=msgs.len() as i64)
        .map(|id| {
            let r = l.message(id).unwrap();
            (r.date, r.thrid, id)
        })
        .collect();
    all.sort_by(|a, b| b.cmp(a));
    let mut want: Vec<i64> = all[..MAX_COLLECTED].iter().map(|k| k.2).collect();
    let mut got: Vec<i64> = before.iter().flat_map(|t| t.3.clone()).collect();
    want.sort_unstable();
    got.sort_unstable();
    assert_eq!(
        got, want,
        "tied group cut at the limit must be by thrid, id"
    );

    let summary = l.rebuild(&|_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        summary.parse_errors, 0,
        "ids are only stable if nothing is skipped"
    );
    assert_eq!(snapshot(&l), before, "rebuild changed result order or set");
}

/// Doc order differs between the two libraries: in B, every third tied
/// message is relabelled by a second import, which re-adds its document at
/// the end of the index. Message ids and final content are identical.
#[test]
fn same_date_results_ignore_index_doc_order() {
    let final_msgs = tied_messages(|n| n % 3 == 0);
    let first_msgs = tied_messages(|_| false);

    let da = TempDir::new().unwrap();
    let mut a = Library::open(&da.path().join("lib")).unwrap();
    import_msgs(&mut a, da.path(), "a.zip", &final_msgs);

    let db = TempDir::new().unwrap();
    let mut b = Library::open(&db.path().join("lib")).unwrap();
    import_msgs(&mut b, db.path(), "b1.zip", &first_msgs);
    import_msgs(&mut b, db.path(), "b2.zip", &final_msgs);

    assert_eq!(a.count().unwrap(), b.count().unwrap());
    assert_eq!(
        snapshot(&a),
        snapshot(&b),
        "doc order leaked into result order or cutoff"
    );
}

/// Grouping sees only the newest MAX_COLLECTED matches; the results say so.
#[test]
fn results_past_the_collected_window_are_flagged_capped() {
    use mail_core::query::exec::MAX_COLLECTED;
    let msgs: Vec<Vec<u8>> = (0..=MAX_COLLECTED as u64)
        .map(|n| {
            MsgBuilder::new()
                .from("bulk@example.com")
                .subject(&format!("bulk{n}"))
                .date_rfc2822("Mon, 01 Jun 2020 10:00:00 +0000")
                .message_id(Some(&format!("<bulk{n}@fixture>")))
                .thrid(n + 1)
                .labels(&["Inbox"])
                .text("capword")
                .build()
        })
        .collect();
    let tmp = TempDir::new().unwrap();
    let l = build_library(tmp.path(), &msgs);
    let all = run(&l, "capword");
    assert_eq!(all.total_messages, MAX_COLLECTED + 1);
    assert!(all.capped, "more matches than the window must be flagged");
    // Exactly the window: complete, not capped.
    let window = run(&l, "capword -subject:bulk0");
    assert_eq!(window.total_messages, MAX_COLLECTED);
    assert!(!window.capped);
    assert!(!run(&l, "bulk7").capped);
}
