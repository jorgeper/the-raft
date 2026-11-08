mod common;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use common::build_library;
use mail_core::Error;
use mail_core::import::scan::{Decision, ScanReport, scan};
use mail_core::import::source::open_source;
use mail_core::library::Library;
use mail_core::model::ImportKind;
use mail_core::testing::{MsgBuilder, mbox_of, zip_of};
use tempfile::TempDir;

const FULL: &str = "All mail Including Spam and Trash.mbox";

fn m(n: u32, date: &str, labels: &[&str]) -> Vec<u8> {
    MsgBuilder::new()
        .subject(&format!("subject {n}"))
        .date_rfc2822(&format!("{date} +0000"))
        .message_id(Some(&format!("<m{n}@fixture>")))
        .thrid(1000 + n as u64)
        .labels(labels)
        .text(&format!("body of message {n}"))
        .build()
}

fn msgs(range: std::ops::RangeInclusive<u32>) -> Vec<Vec<u8>> {
    range
        .map(|n| m(n, "Mon, 02 Nov 2026 10:00:00", &["Inbox"]))
        .collect()
}

fn write_mbox(dir: &Path, name: &str, msgs: &[Vec<u8>]) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, mbox_of(msgs)).unwrap();
    p
}

fn write_full_mbox(dir: &Path, msgs: &[Vec<u8>]) -> PathBuf {
    let sub = dir.join("full");
    std::fs::create_dir_all(&sub).unwrap();
    write_mbox(&sub, FULL, msgs)
}

fn run(lib: &Library, p: &Path) -> ScanReport {
    scan(lib, &[p.to_path_buf()], &|_| {}, &AtomicBool::new(false)).unwrap()
}

fn lib_with(dir: &TempDir, msgs: &[Vec<u8>]) -> Library {
    build_library(&dir.path().join("lib"), msgs)
}

#[test]
fn streams_from_zip() {
    let dir = TempDir::new().unwrap();
    let mbox = mbox_of(&msgs(1..=3));
    let full = dir.path().join("full.zip");
    std::fs::write(&full, zip_of(&format!("Takeout/Mail/{FULL}"), &mbox)).unwrap();
    let part = dir.path().join("part.zip");
    std::fs::write(&part, zip_of("Takeout/Mail/Work.mbox", &mbox)).unwrap();

    let s = open_source(std::slice::from_ref(&full)).unwrap();
    assert_eq!(s.kind, ImportKind::Full);
    assert_eq!(s.label, FULL);
    let s = open_source(std::slice::from_ref(&part)).unwrap();
    assert_eq!(s.kind, ImportKind::Partial);

    let lib = lib_with(&dir, &[]);
    let r = run(&lib, &full);
    assert_eq!((r.kind, r.total, r.new), (ImportKind::Full, 3, 3));
    assert!(
        r.plan
            .decisions
            .iter()
            .all(|d| matches!(d, Decision::New(_)))
    );
}

#[test]
fn zip_search_across_files_and_errors() {
    let dir = TempDir::new().unwrap();
    let other = dir.path().join("a.zip");
    std::fs::write(&other, zip_of("Takeout/readme.html", b"hi")).unwrap();
    let with = dir.path().join("b.zip");
    std::fs::write(&with, zip_of("Takeout/Mail/X.MBOX", &mbox_of(&msgs(1..=1)))).unwrap();
    assert_eq!(
        open_source(&[other.clone(), with.clone()]).unwrap().kind,
        ImportKind::Partial
    );
    assert!(open_source(std::slice::from_ref(&other)).is_err());
    assert!(open_source(&[with.clone(), with]).is_err());
}

#[test]
fn first_scan_all_new() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[]);
    let p = write_full_mbox(dir.path(), &msgs(1..=5));
    let r = run(&lib, &p);
    assert_eq!((r.total, r.new, r.unchanged, r.removed), (5, 5, 0, 0));
    assert_eq!(r.removed_fraction, 0.0);
    assert!(!r.looks_older);
    assert_eq!(r.plan.total, 5);
}

#[test]
fn new_decisions_carry_content_keys() {
    use mail_core::model::RawMessage;
    use mail_core::parse::{dedupe_keys, parse_message};
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[]);
    let src = msgs(1..=3);
    let p = write_full_mbox(dir.path(), &src);
    let r = run(&lib, &p);
    let want: Vec<Decision> = src
        .iter()
        .map(|b| {
            let raw = RawMessage {
                bytes: b.clone(),
                from_line_date: None,
            };
            Decision::New(dedupe_keys(&raw, &parse_message(&raw).unwrap()).content_key)
        })
        .collect();
    assert_eq!(r.plan.decisions, want);
}

#[test]
fn rescan_detects_changes() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &msgs(1..=6));
    // 1 missing (msg 1), msg 2 relabelled, msgs 3..=6 same, +2 new.
    let mut a2 = vec![m(2, "Mon, 02 Nov 2026 10:00:00", &["Inbox", "Work"])];
    a2.extend(msgs(3..=8));
    let p = write_full_mbox(dir.path(), &a2);
    let r = run(&lib, &p);
    assert_eq!(
        (
            r.new,
            r.label_changes,
            r.removed,
            r.unchanged,
            r.matched_by_content
        ),
        (2, 1, 1, 4, 5)
    );
    assert!((r.removed_fraction - 1.0 / 6.0).abs() < 1e-9);
    assert!(matches!(r.plan.decisions[0], Decision::Relabel(..)));
    assert_eq!(r.plan.removed.len(), 1);
    assert!(!r.looks_older);
}

#[test]
fn label_order_is_irrelevant() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[m(1, "Mon, 02 Nov 2026 10:00:00", &["A", "B"])]);
    let p = write_full_mbox(
        dir.path(),
        &[m(1, "Mon, 02 Nov 2026 10:00:00", &["B", "A"])],
    );
    let r = run(&lib, &p);
    assert_eq!((r.label_changes, r.unchanged, r.new), (0, 1, 0));
}

#[test]
fn refolded_headers_match_by_header() {
    let dir = TempDir::new().unwrap();
    let orig = m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox"]);
    let lib = lib_with(&dir, std::slice::from_ref(&orig));
    let text = String::from_utf8(orig).unwrap();
    let refolded = text.replace("Subject: subject 1", "Subject: subject\n 1");
    assert_ne!(text, refolded);
    let p = write_full_mbox(dir.path(), &[refolded.into_bytes()]);
    let r = run(&lib, &p);
    assert_eq!(
        (r.matched_by_header, r.matched_by_content, r.new),
        (1, 0, 0)
    );
    assert_eq!(r.unchanged, 1);
}

#[test]
fn colliding_message_ids_both_new() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox"])]);
    let mk = |thrid: u64, body: &str| {
        MsgBuilder::new()
            .subject("subject 1")
            .date_rfc2822("Mon, 02 Nov 2026 10:00:00 +0000")
            .message_id(Some("<m1@fixture>"))
            .thrid(thrid)
            .text(body)
            .build()
    };
    let p = write_full_mbox(dir.path(), &[mk(7, "one"), mk(8, "two")]);
    let r = run(&lib, &p);
    assert_eq!((r.new, r.matched_by_header), (2, 0));
}

#[test]
fn header_match_is_claimed_once() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox"])]);
    let base = String::from_utf8(m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox"])).unwrap();
    let a = base.replace("body of message 1", "edited a").into_bytes();
    let b = base.replace("body of message 1", "edited b").into_bytes();
    let p = write_full_mbox(dir.path(), &[a, b]);
    let r = run(&lib, &p);
    assert_eq!((r.matched_by_header, r.new), (1, 1));
}

#[test]
fn partial_never_relabels_or_removes() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &msgs(1..=3));
    let p = write_mbox(
        dir.path(),
        "Work.mbox",
        &[m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox", "Work"])],
    );
    let r = run(&lib, &p);
    assert_eq!(r.kind, ImportKind::Partial);
    assert_eq!(
        (r.unchanged, r.label_changes, r.removed, r.new),
        (1, 0, 0, 0)
    );
    assert_eq!(r.plan.decisions, vec![Decision::Unchanged]);
    assert!(r.plan.removed.is_empty());
}

#[test]
fn older_export_flagged() {
    let dir = TempDir::new().unwrap();
    let mut have = msgs(1..=3);
    have.push(m(4, "Thu, 05 Nov 2026 10:00:00", &["Inbox"])); // library newest
    let lib = lib_with(&dir, &have);
    let old = vec![
        m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox", "Work"]),
        m(9, "Sun, 01 Nov 2026 10:00:00", &["Inbox"]),
    ];
    let p = write_full_mbox(dir.path(), &old);
    let r = run(&lib, &p);
    assert!(r.looks_older);
    assert_eq!(r.removed, 0);
    assert!(r.plan.removed.is_empty());
    assert_eq!(r.label_changes, 0);
    assert!(
        !r.plan
            .decisions
            .iter()
            .any(|d| matches!(d, Decision::Relabel(..)))
    );
    assert!(matches!(
        r.plan.decisions[..],
        [Decision::Unchanged, Decision::New(_)]
    ));
}

#[test]
fn duplicates_in_source_are_skipped() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[]);
    let one = m(1, "Mon, 02 Nov 2026 10:00:00", &["Inbox"]);
    let p = write_full_mbox(dir.path(), &[one.clone(), one]);
    let r = run(&lib, &p);
    assert_eq!((r.new, r.duplicates_in_source, r.total), (1, 1, 2));
    assert!(matches!(
        r.plan.decisions[..],
        [Decision::New(_), Decision::Skip]
    ));
}

#[test]
fn scan_counts_parse_errors_and_continues() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[]);
    let p = write_full_mbox(
        dir.path(),
        &[
            msgs(1..=1).remove(0),
            b"\x00\x01\x02 not a message at all".to_vec(),
            msgs(2..=2).remove(0),
        ],
    );
    let r = run(&lib, &p);
    assert_eq!((r.total, r.new, r.parse_errors), (3, 2, 1));
    assert_eq!(r.plan.decisions[1], Decision::Skip);
}

#[test]
fn cancel_stops_scan() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[]);
    let p = write_full_mbox(dir.path(), &msgs(1..=3));
    let cancel = AtomicBool::new(true);
    let e = scan(&lib, &[p], &|_| {}, &cancel).unwrap_err();
    assert!(matches!(e, Error::Cancelled));
}

#[test]
fn progress_reports_bytes() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &[]);
    let p = write_full_mbox(dir.path(), &msgs(1..=3));
    let size = std::fs::metadata(&p).unwrap().len();
    let last = AtomicU64::new(0);
    let bytes = std::sync::Mutex::new(Vec::new());
    scan(
        &lib,
        &[p],
        &|pr| {
            assert_eq!(pr.total_bytes, Some(size));
            last.store(pr.processed, Ordering::Relaxed);
            bytes.lock().unwrap().push(pr.bytes);
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(last.load(Ordering::Relaxed), 3);
    let bytes = bytes.into_inner().unwrap();
    assert!(bytes.windows(2).all(|w| w[0] <= w[1]));
    assert!(*bytes.last().unwrap() > 0);
}

#[test]
fn empty_full_source_never_removes() {
    let dir = TempDir::new().unwrap();
    let lib = lib_with(&dir, &msgs(1..=3));
    let p = write_full_mbox(dir.path(), &[b"\x00\x01 garbage".to_vec()]);
    let r = run(&lib, &p);
    assert_eq!((r.parse_errors, r.removed), (1, 0));
    assert!(r.plan.removed.is_empty());
    let p = write_full_mbox(dir.path(), &[]);
    let r = run(&lib, &p);
    assert_eq!((r.total, r.removed), (0, 0));
    assert!(r.plan.removed.is_empty());
}

fn u16le(v: &mut Vec<u8>, x: u16) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn u32le(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn u64le(v: &mut Vec<u8>, x: u64) {
    v.extend_from_slice(&x.to_le_bytes());
}

/// Takeout-shaped zip: zip64 deflate entry with a data descriptor, differing
/// local/central extra fields, then a second entry. Returns (zip, compressed
/// length of the first entry's data).
fn takeout_shaped_zip(mbox: &[u8]) -> (Vec<u8>, usize) {
    use std::io::Write;
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(mbox).unwrap();
    let comp = enc.finish().unwrap();
    let crc = crc32fast::hash(mbox);
    let name = format!("Takeout/Mail/{FULL}").into_bytes();
    let mut z = Vec::new();
    u32le(&mut z, 0x04034b50);
    u16le(&mut z, 45);
    u16le(&mut z, 0x0808);
    u16le(&mut z, 8);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u32le(&mut z, 0);
    u32le(&mut z, 0xFFFF_FFFF);
    u32le(&mut z, 0xFFFF_FFFF);
    u16le(&mut z, name.len() as u16);
    u16le(&mut z, 80);
    z.extend_from_slice(&name);
    // local extra (80 bytes): zip64 placeholder + padding field
    u16le(&mut z, 0x0001);
    u16le(&mut z, 16);
    u64le(&mut z, 0);
    u64le(&mut z, 0);
    u16le(&mut z, 0xCAFE);
    u16le(&mut z, 56);
    z.extend_from_slice(&[0xAB; 56]);
    z.extend_from_slice(&comp);
    // zip64 data descriptor
    u32le(&mut z, 0x08074b50);
    u32le(&mut z, crc);
    u64le(&mut z, comp.len() as u64);
    u64le(&mut z, mbox.len() as u64);
    // second entry: bytes that look like an mbox but must never be read
    let off2 = z.len() as u32;
    let name2 = b"Takeout/archive_browser.html";
    let data2 = b"From garbage@x NOT PART OF MBOX\n\n<html>";
    u32le(&mut z, 0x04034b50);
    u16le(&mut z, 20);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u32le(&mut z, crc32fast::hash(data2));
    u32le(&mut z, data2.len() as u32);
    u32le(&mut z, data2.len() as u32);
    u16le(&mut z, name2.len() as u16);
    u16le(&mut z, 0);
    z.extend_from_slice(name2);
    z.extend_from_slice(data2);
    let cd_start = z.len();
    // central extra (92 bytes): timestamp + zip64 sizes + Unicode path
    let mut ex = Vec::new();
    u16le(&mut ex, 0x5455);
    u16le(&mut ex, 8);
    u64le(&mut ex, 0);
    u16le(&mut ex, 0x0001);
    u16le(&mut ex, 16);
    u64le(&mut ex, mbox.len() as u64);
    u64le(&mut ex, comp.len() as u64);
    u16le(&mut ex, 0x7075);
    u16le(&mut ex, (5 + name.len()) as u16);
    ex.push(1);
    u32le(&mut ex, crc32fast::hash(&name));
    ex.extend_from_slice(&name);
    u32le(&mut z, 0x02014b50);
    u16le(&mut z, 45);
    u16le(&mut z, 45);
    u16le(&mut z, 0x0808);
    u16le(&mut z, 8);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u32le(&mut z, crc);
    u32le(&mut z, 0xFFFF_FFFF);
    u32le(&mut z, 0xFFFF_FFFF);
    u16le(&mut z, name.len() as u16);
    u16le(&mut z, ex.len() as u16);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u32le(&mut z, 0);
    u32le(&mut z, 0);
    z.extend_from_slice(&name);
    z.extend_from_slice(&ex);
    u32le(&mut z, 0x02014b50);
    u16le(&mut z, 20);
    u16le(&mut z, 20);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u32le(&mut z, crc32fast::hash(data2));
    u32le(&mut z, data2.len() as u32);
    u32le(&mut z, data2.len() as u32);
    u16le(&mut z, name2.len() as u16);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u32le(&mut z, 0);
    u32le(&mut z, off2);
    z.extend_from_slice(name2);
    let cd_len = z.len() - cd_start;
    u32le(&mut z, 0x06054b50);
    u16le(&mut z, 0);
    u16le(&mut z, 0);
    u16le(&mut z, 2);
    u16le(&mut z, 2);
    u32le(&mut z, cd_len as u32);
    u32le(&mut z, cd_start as u32);
    u16le(&mut z, 0);
    (z, comp.len())
}

fn read_all(p: &Path) -> (ImportKind, Vec<u8>, u64) {
    use std::io::Read;
    let mut s = open_source(&[p.to_path_buf()]).unwrap();
    let mut out = Vec::new();
    s.reader.read_to_end(&mut out).unwrap();
    (s.kind, out, s.bytes_read.load(Ordering::Relaxed))
}

#[test]
fn real_takeout_zip_shape() {
    let dir = TempDir::new().unwrap();
    let mbox = mbox_of(&msgs(1..=200));
    let (z, comp_len) = takeout_shaped_zip(&mbox);
    let p = dir.path().join("takeout.zip");
    std::fs::write(&p, &z).unwrap();
    let (kind, out, bytes) = read_all(&p);
    assert_eq!(kind, ImportKind::Full);
    assert!(out == mbox, "mbox content must be byte-identical");
    assert_eq!(bytes, comp_len as u64, "must not read past the entry");

    let lib = lib_with(&dir, &[]);
    let r = run(&lib, &p);
    assert_eq!((r.total, r.new, r.parse_errors), (200, 200, 0));
}

#[test]
fn stored_entry_streams() {
    let dir = TempDir::new().unwrap();
    let mbox = mbox_of(&msgs(1..=20));
    let p = dir.path().join("stored.zip");
    let mut zw = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zw.start_file(format!("Takeout/Mail/{FULL}"), opts).unwrap();
    std::io::Write::write_all(&mut zw, &mbox).unwrap();
    zw.start_file("Takeout/after.txt", opts).unwrap();
    std::io::Write::write_all(&mut zw, b"From x\n\ntrailing").unwrap();
    zw.finish().unwrap();
    let (kind, out, bytes) = read_all(&p);
    assert_eq!(kind, ImportKind::Full);
    assert!(out == mbox);
    assert_eq!(bytes, mbox.len() as u64);
}

#[test]
fn corrupted_zip_fails_scan() {
    let dir = TempDir::new().unwrap();
    let mbox = mbox_of(&msgs(1..=2000));
    let (mut z, comp_len) = takeout_shaped_zip(&mbox);
    let at = 30 + format!("Takeout/Mail/{FULL}").len() + 80 + comp_len / 2;
    z[at] ^= 0x10;
    let p = dir.path().join("corrupt.zip");
    std::fs::write(&p, &z).unwrap();
    let lib = lib_with(&dir, &[]);
    let r = scan(&lib, &[p], &|_| {}, &AtomicBool::new(false));
    assert!(
        r.is_err(),
        "total {:?} comp {comp_len} at {at}",
        r.map(|r| r.total)
    );
}
