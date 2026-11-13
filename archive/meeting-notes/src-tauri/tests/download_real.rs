//! Real network download of the smallest catalog model. Ignored by default —
//! run explicitly: cargo test --test download_real -- --ignored --nocapture

#[test]
#[ignore]
fn downloads_and_verifies_tiny() {
    let dir = std::env::temp_dir().join(format!("minutes-dl-{}", std::process::id()));
    std::env::set_var("MINUTES_MODELS_DIR", &dir);

    let mut events = 0u32;
    minutes_lib::models::download("tiny", |d, t| {
        events += 1;
        if events % 40 == 0 {
            eprintln!("  {d}/{t}");
        }
    })
    .expect("download failed");

    let path = minutes_lib::stt::model_path("tiny");
    assert!(path.exists());
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes.len() as u64, 77_691_713);
    assert_eq!(
        minutes_lib::models::sha256_hex(&bytes),
        "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"
    );
    assert!(events > 10, "progress callback should fire many times");
    std::fs::remove_dir_all(&dir).ok();
    eprintln!("tiny downloaded, sha256 verified, cleaned up");
}
