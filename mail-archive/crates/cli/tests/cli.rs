use mail_core::testing::{MsgBuilder, mbox_of, zip_of};
use std::path::Path;
use std::process::{Command, Output};

const SUBJECT: &str = "Quarterly planning notes";

fn fixture_zip(dir: &Path) -> std::path::PathBuf {
    let msgs = vec![
        MsgBuilder::new()
            .from("Ana <ana@example.com>")
            .to("bob@example.com")
            .subject(SUBJECT)
            .thrid(1)
            .labels(&["Inbox"])
            .text("hello there")
            .build(),
        MsgBuilder::new()
            .from("carl@example.com")
            .subject("Something else")
            .thrid(2)
            .labels(&["Inbox"])
            .text("other")
            .build(),
    ];
    let p = dir.join("takeout.zip");
    std::fs::write(
        &p,
        zip_of(
            "Takeout/Mail/All mail Including Spam and Trash.mbox",
            &mbox_of(&msgs),
        ),
    )
    .unwrap();
    p
}

fn run(lib: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mail-cli"))
        .arg("--library")
        .arg(lib)
        .args(args)
        .output()
        .unwrap()
}

fn setup() -> (tempfile::TempDir, std::path::PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let zip = fixture_zip(tmp.path());
    let lib = tmp.path().join("lib");
    let out = run(&lib, &["import", zip.to_str().unwrap(), "--yes"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    (tmp, lib)
}

#[test]
fn cli_import_and_search() {
    let (_tmp, lib) = setup();
    let out = run(&lib, &["search", "from:ana"]);
    assert!(out.status.success());
    let s = String::from_utf8(out.stdout).unwrap();
    assert!(s.contains(SUBJECT), "{s}");
    assert!(!s.contains("Something else"), "{s}");
    assert!(s.contains("1 messages"), "{s}");
}

#[test]
fn cli_bench_prints_percentiles() {
    let (_tmp, lib) = setup();
    let out = run(&lib, &["bench"]);
    assert!(out.status.success());
    let s = String::from_utf8(out.stdout).unwrap();
    assert!(s.contains("p95"), "{s}");
    assert!(!s.contains(SUBJECT), "{s}");
}

#[test]
fn cli_search_strips_terminal_escapes() {
    let tmp = tempfile::tempdir().unwrap();
    let msg = MsgBuilder::new()
        .from("Eve <eve@example.com>")
        .subject("evil \x1b[2Jsubject")
        .thrid(1)
        .labels(&["Inbox"])
        .text("x")
        .build();
    let zip = tmp.path().join("t.zip");
    std::fs::write(
        &zip,
        zip_of(
            "Takeout/Mail/All mail Including Spam and Trash.mbox",
            &mbox_of(&[msg]),
        ),
    )
    .unwrap();
    let lib = tmp.path().join("lib");
    assert!(
        run(&lib, &["import", zip.to_str().unwrap(), "--yes"])
            .status
            .success()
    );
    let out = run(&lib, &["search", "from:eve"]);
    assert!(out.status.success());
    assert!(
        !out.stdout.contains(&0x1b),
        "{:?}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("evil ?[2Jsubject"));
}
