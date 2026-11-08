# mail-archive

A local-only Mac app that imports Gmail Takeout mbox files and searches them
offline with Gmail-style queries. Mail never leaves the machine: the app makes
no network requests. This repository holds a Rust core library (`crates/core`)
plus, in later milestones, a CLI and a Tauri shell. Tests use synthetic
fixtures only; never commit real mail.

## Tests

```sh
cargo test -p mail-core
cargo clippy --all-targets -- -D warnings
```
