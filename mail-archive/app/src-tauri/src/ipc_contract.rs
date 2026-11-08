//! IPC contract tests: what the commands send across the JSON boundary.
//!
//! JavaScript numbers hold integers exactly only up to 2^53, and Gmail thread
//! ids are ~1.9e18. Every IPC payload is checked for numbers past that bound,
//! and golden JSON files (read by the TypeScript tests too) pin the wire
//! format. Regenerate the golden files with `UPDATE_IPC_FIXTURES=1`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mail_core::import::scan::Progress;
use mail_core::library::{SearchResults, SuggestKind, ThreadHit};
use mail_core::testing::{MsgBuilder, mbox_of, zip_of};
use serde::Serialize;
use serde_json::Value;

use crate::commands::test_support;

/// A real-sized Gmail thread id, and its neighbour: both parse to the same
/// JavaScript number (1868012345678901200).
const THRID: i64 = 1_868_012_345_678_901_234;
const THRID_NEXT: i64 = THRID + 1;
const NOW: i64 = 1_800_000_000;
/// 2^53: the largest magnitude a JS number holds without losing integers.
const JS_SAFE: f64 = 9_007_199_254_740_992.0;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/ipc-fixtures")
}

/// Compare `value`'s JSON with the golden file (or rewrite it when asked).
fn golden<T: Serialize>(name: &str, value: &T) {
    let text = serde_json::to_string_pretty(value).unwrap() + "\n";
    let path = fixtures_dir().join(name);
    if std::env::var_os("UPDATE_IPC_FIXTURES").is_some() {
        std::fs::create_dir_all(fixtures_dir()).unwrap();
        std::fs::write(&path, &text).unwrap();
    }
    let on_disk = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing {name}; run with UPDATE_IPC_FIXTURES=1"));
    assert_eq!(
        on_disk, text,
        "{name} is out of date; run with UPDATE_IPC_FIXTURES=1"
    );
}

/// Every JSON number in `v` whose magnitude exceeds 2^53, with its path.
fn unsafe_numbers(v: &Value, path: &str, out: &mut Vec<String>) {
    match v {
        Value::Number(n) => {
            let big = match (n.as_i64(), n.as_u64(), n.as_f64()) {
                (Some(i), _, _) => i.unsigned_abs() > 1 << 53,
                (None, Some(u), _) => u > 1 << 53,
                (_, _, Some(f)) => f.abs() > JS_SAFE,
                _ => true,
            };
            if big {
                out.push(format!("{path} = {n}"));
            }
        }
        Value::Array(a) => {
            for (i, x) in a.iter().enumerate() {
                unsafe_numbers(x, &format!("{path}[{i}]"), out);
            }
        }
        Value::Object(o) => {
            for (k, x) in o {
                unsafe_numbers(x, &format!("{path}.{k}"), out);
            }
        }
        _ => {}
    }
}

fn assert_js_safe(what: &str, v: &impl Serialize) {
    let mut bad = Vec::new();
    unsafe_numbers(&serde_json::to_value(v).unwrap(), what, &mut bad);
    assert!(bad.is_empty(), "integers past 2^53 cross IPC: {bad:?}");
}

fn hit(thrid: i64, matched: Vec<i64>, subject: &str) -> ThreadHit {
    ThreadHit {
        thrid,
        latest_date: 1_700_000_000,
        senders: vec!["Ana".into()],
        message_count: matched.len() as u32,
        subject: subject.into(),
        snippet: "hello there".into(),
        has_attachment: false,
        matched,
    }
}

/// Two threads whose ids collide as JavaScript numbers.
fn sample_search() -> SearchResults {
    SearchResults {
        threads: vec![
            hit(THRID_NEXT, vec![3], "Second thread"),
            hit(THRID, vec![2, 1], "First thread"),
        ],
        total_messages: 3,
        capped: false,
        elapsed_ms: 1.25,
        chips: vec![],
        hints: vec![],
        terms: vec!["hello".into()],
    }
}

#[test]
fn search_cap_matches_the_ui_header() {
    assert_eq!(
        mail_core::query::exec::MAX_COLLECTED,
        5_000,
        "update MAX_COLLECTED in app/src/lib/format.ts to match"
    );
}

#[test]
fn search_results_send_thread_ids_as_strings() {
    golden("search.json", &sample_search());
    let json = serde_json::to_string(&sample_search()).unwrap();
    assert!(
        json.contains("\"thrid\":\"1868012345678901234\""),
        "thrid is not a quoted string: {json}"
    );
    assert!(json.contains("\"thrid\":\"1868012345678901235\""), "{json}");
}

fn thread_msg(n: u32, thrid: u64) -> Vec<u8> {
    MsgBuilder::new()
        .from(&format!("Sender {n} <s{n}@example.com>"))
        .subject("Big thread id")
        .thrid(thrid)
        .labels(&["Inbox", "Work"])
        .date_rfc2822(&format!("Mon, {:02} Jun 2020 10:00:00 +0000", n + 1))
        .message_id(Some(&format!("<big{n}@x>")))
        .text(&format!("hello number{n}"))
        .attach("a.txt", "text/plain", b"x")
        .build()
}

/// Every command's return value and every event payload, built from a real
/// fixture library whose Gmail thread id is past 2^53, has only JS-safe numbers.
#[test]
fn no_ipc_payload_carries_an_integer_past_2_pow_53() {
    let msgs = [thread_msg(1, THRID as u64), thread_msg(2, THRID as u64)];
    let (st, _ids, d) = test_support::state_with(&msgs);

    let res = st.search("", 0, 50, NOW, &chrono::Utc).unwrap();
    assert_eq!(res.threads.len(), 1);
    assert_eq!(res.threads[0].thrid, THRID);
    assert_js_safe("search", &res);
    assert_js_safe(
        "get_thread",
        &st.thread(&res.threads[0].thrid.to_string(), &res.terms)
            .unwrap(),
    );
    assert_js_safe(
        "autocomplete",
        &st.autocomplete(SuggestKind::Label, "").unwrap(),
    );
    assert_js_safe(
        "autocomplete",
        &st.autocomplete(SuggestKind::Address, "s").unwrap(),
    );
    assert_js_safe("library_status", &st.status().unwrap());

    let events: Mutex<Vec<Progress>> = Mutex::default();
    let progress = |p: Progress| events.lock().unwrap().push(p);
    let zip = d.path().join("takeout.zip");
    std::fs::write(
        &zip,
        zip_of(
            "Takeout/Mail/All mail Including Spam and Trash.mbox",
            &mbox_of(&[thread_msg(1, THRID as u64), thread_msg(3, THRID as u64)]),
        ),
    )
    .unwrap();
    assert_js_safe("import_scan", &st.scan(&[zip], &progress).unwrap());
    assert_js_safe("import_apply", &st.apply_pending(&progress).unwrap());
    st.rebuild(&progress).unwrap();
    let events = events.into_inner().unwrap();
    assert!(!events.is_empty());
    assert_js_safe("progress event", &events);

    let other = d.path().join("other");
    assert_js_safe(
        "set_library_path",
        &st.set_library(other.to_str().unwrap()).unwrap(),
    );
    assert_js_safe(
        "check_library_folder",
        &crate::commands::folder_needs_confirmation(&other),
    );
}

fn view(id: i64, date: i64) -> crate::commands::MessageView {
    crate::commands::MessageView {
        id,
        thrid: THRID,
        from: Some(mail_core::model::Address {
            name: Some("Ana".into()),
            addr: "ana@example.com".into(),
        }),
        to: vec![],
        cc: vec![],
        date,
        labels: vec!["Inbox".into()],
        subject: "First thread".into(),
        attachments: vec![],
        body_url: crate::protocol::body_url(id, &["hello".into()]),
        blocked_remote: 0,
        body_failed: false,
    }
}

#[test]
fn message_views_send_thread_ids_as_strings() {
    let views = vec![view(1, 1_699_000_000), view(2, 1_700_000_000)];
    golden("thread.json", &views);
    let json = serde_json::to_string(&views).unwrap();
    assert_eq!(
        json.matches("\"thrid\":\"1868012345678901234\"").count(),
        2,
        "{json}"
    );
}

/// search -> the thread id as the UI sees it (a JSON string) -> get_thread.
#[test]
fn get_thread_opens_the_thread_id_taken_from_search_json() {
    let msgs = [
        thread_msg(1, THRID as u64),
        thread_msg(2, THRID as u64),
        // Its id is one past THRID: the same JS number, a different thread.
        thread_msg(3, THRID_NEXT as u64),
    ];
    let (st, _ids, _d) = test_support::state_with(&msgs);
    let res = serde_json::to_value(st.search("hello", 0, 50, NOW, &chrono::Utc).unwrap()).unwrap();
    let thrids: Vec<&str> = res["threads"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["thrid"].as_str().expect("thrid is a JSON string"))
        .collect();
    assert_eq!(thrids, ["1868012345678901235", "1868012345678901234"]);

    let views = st.thread(thrids[1], &["hello".into()]).unwrap();
    assert_eq!(views.len(), 2);
    assert!(views.iter().all(|v| v.thrid == THRID));
    let json = serde_json::to_value(&views).unwrap();
    assert_eq!(json[0]["thrid"], "1868012345678901234");
    assert_eq!(st.thread(thrids[0], &[]).unwrap().len(), 1);
}

#[test]
fn get_thread_rejects_a_thread_id_that_is_not_an_integer() {
    let (st, _ids, _d) = test_support::state_with(&[thread_msg(1, THRID as u64)]);
    for bad in [
        "",
        "abc",
        "1.5",
        "1868012345678901200.0",
        "1e18",
        " 1",
        "+1",
        "-",
        "99999999999999999999",
    ] {
        assert_eq!(
            st.thread(bad, &[]).err().as_deref(),
            Some("bad thread id"),
            "{bad:?}"
        );
    }
    // Synthetic thread ids are negative; they parse.
    assert!(st.thread("-5", &[]).unwrap().is_empty());
}
