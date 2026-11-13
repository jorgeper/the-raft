//! The app must never talk to the network. These tests pin the CSP and the
//! dependency graph.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Command;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn conf() -> serde_json::Value {
    let s = std::fs::read_to_string(crate_dir().join("tauri.conf.json")).unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn app_csp_has_no_remote() {
    let conf = conf();
    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp must be a string");
    assert!(csp.contains("default-src 'self'"), "{csp}");

    // Tauri's local IPC origin is the only allowed network-looking source.
    const IPC_ORIGIN: &str = "http://ipc.localhost";
    for directive in csp.split(';') {
        for src in directive.split_whitespace().skip(1) {
            if src == IPC_ORIGIN {
                continue;
            }
            let lower = src.to_ascii_lowercase();
            for bad in ["http:", "https:", "ws:", "wss:"] {
                assert!(!lower.contains(bad), "remote source {src:?} in {csp}");
            }
            assert!(!src.contains('*'), "wildcard source {src:?} in {csp}");
        }
    }
    assert_eq!(
        csp,
        "default-src 'self'; img-src 'self' mailcid: data:; style-src 'self' 'unsafe-inline'; \
         frame-src mailbody:; connect-src ipc: http://ipc.localhost"
    );
    assert_eq!(conf["bundle"]["createUpdaterArtifacts"], false);
    assert!(conf["plugins"]["updater"].is_null());
}

#[test]
fn no_network_plugins() {
    const FORBIDDEN: &[&str] = &[
        "tauri-plugin-updater",
        "tauri-plugin-http",
        "tauri-plugin-websocket",
        "reqwest",
        "ureq",
        "hyper",
    ];
    // The app is macOS-only. `cargo metadata` without a platform filter also
    // resolves other targets, and tauri pulls reqwest/hyper only for
    // android and iOS, so we take the union of the two macOS target graphs.
    // The forbidden list is deliberately unchanged. Task 18's nettop run is
    // the runtime proof that the app makes no connections.
    let mut seen_names: HashSet<String> = HashSet::new();
    for target in ["aarch64-apple-darwin", "x86_64-apple-darwin"] {
        let out = Command::new(env!("CARGO"))
            .args(["metadata", "--format-version", "1", "--locked"])
            .args(["--filter-platform", target])
            .arg("--manifest-path")
            .arg(crate_dir().join("Cargo.toml"))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let meta: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        let id_to_name: HashMap<&str, &str> = meta["packages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p["id"].as_str().unwrap(), p["name"].as_str().unwrap()))
            .collect();
        let by_id: HashMap<&str, &serde_json::Value> = meta["resolve"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| (n["id"].as_str().unwrap(), n))
            .collect();
        // Walk only what is reachable from the app, not the whole workspace.
        let root = id_to_name
            .iter()
            .find(|(_, n)| **n == "mail-archive-app")
            .map(|(id, _)| *id)
            .unwrap();
        let mut seen = HashSet::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if !seen.insert(id) {
                continue;
            }
            let name = id_to_name[id];
            assert!(
                !FORBIDDEN.contains(&name),
                "forbidden crate {name} in graph for {target}"
            );
            seen_names.insert(name.to_string());
            for d in by_id[id]["deps"].as_array().unwrap() {
                stack.push(d["pkg"].as_str().unwrap());
            }
        }
    }
    let seen = &seen_names;
    assert!(seen.len() > 50, "graph looks empty: {}", seen.len());
}
