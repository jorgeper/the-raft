# mail-archive

A fast, local-only Mac app for searching and browsing a Gmail Takeout. Import
the Takeout's mbox zips once, then search with Gmail-style queries and read
mail in a Gmail-like reading pane. Everything stays on this machine. The app
makes no network requests, and remote images in mail are blocked.

- `crates/core` holds the library: import and diff, the store, SQLite, the
  Tantivy index, the query language and safe HTML rendering.
- `crates/cli` is `mail-cli`: import, search, rebuild and bench from the terminal.
- `app/` is the Tauri 2 desktop app, with Svelte 5 + TypeScript for the UI and
  Rust in `app/src-tauri`.

Tests use synthetic fixtures only. Never commit real mail.

## Build

Requirements: Rust 1.96+, Node 22+, pnpm.

```sh
cd app
pnpm install
pnpm tauri build          # → ../target/release/bundle/macos/Mail Archive.app
```

The bundle lands in the workspace target directory: `target/release/bundle/macos/`
from the repo root.

The app is unsigned. The first time you open it, right-click and choose Open
(or allow it in System Settings ▸ Privacy & Security).

To develop with hot reload, run `pnpm tauri dev`.

To build the CLI:

```sh
cargo build --release -p mail-cli   # → target/release/mail-cli
```

## Import a Takeout

1. In Google Takeout, export **Mail** (mbox). Download every zip of the export.
2. Open Mail Archive. The first time, it shows where the library will live; you
   can choose another folder. Then click **Import Takeout…** and select all of
   the zips. You can also select an `.mbox` file.
3. The app scans first, then shows what would change before it touches
   anything, for example:
   `412,330 already in library · 3,812 new · 1,140 label changes · 96 no longer in Gmail (kept)`.
   Click **Import** to apply the changes.

**Re-importing a newer Takeout** adds only new mail and updates labels.
Re-importing the same Takeout changes nothing. Mail you deleted in Gmail is
**kept** and marked `is:removed`. If the export looks older than the library,
the import only adds new mail and never removes anything.

The same flow works from the terminal:

```sh
mail-cli import takeout-*.zip          # shows the summary, asks before applying
mail-cli import takeout-*.zip --yes    # applies without asking
```

**Rebuild Index** (in the app menu, or `mail-cli rebuild`) regenerates SQLite
and the search index from the store and event log. Use it if search ever looks
wrong, or when the app asks for it.

## Where the library lives

Default location: `~/Library/Application Support/mail-archive/library/`. App
settings live in `~/Library/Application Support/mail-archive/config.json`.

| Path | What it is |
|---|---|
| `store/pack-NNNNN.zst` | Raw messages, zstd-compressed, append-only (source of truth) |
| `events.log` | Append-only record of imports and label changes (source of truth) |
| `meta.sqlite` | Message metadata (rebuildable cache) |
| `index/` | Tantivy search index (rebuildable cache) |
| `LOCK` | Held while the app or `mail-cli` has the library open |

Keep the library out of Dropbox, iCloud Drive, Google Drive and OneDrive; the
app warns if you pick a folder inside one, and for `~/Desktop` and
`~/Documents`, which iCloud "Desktop & Documents" sync may upload. Only one process can open the
library at a time. Quit the app before running `mail-cli` on the same library.

## Search

Type in the search box. Results update as you type, and the parsed query is
shown as chips below the box. You can remove a chip with ✕, or add one with
**+ label** or **+ date**.

Results are grouped from the newest 5,000 matching messages. When more match,
the header says so; narrow the search (for example with `before:`) to reach
older mail.

| Key | Action |
|---|---|
| `⌘F` or `/` | Focus search |
| `↓` or `Enter` (in search) | Go to the results list (with suggestions open, they pick a suggestion instead) |
| `↑` / `↓` (in list) | Move through results |
| `Enter` / `→` (in list) | Read the selected conversation |
| `Esc` | Clear search, or go back to the list |
| `⌘C` (in list) | Copy subject — sender — date |
| `⌘I` | Import Takeout… |

### Query syntax

Gmail-compatible subset. Operators are case-insensitive; values may be quoted.

| Syntax | Meaning |
|---|---|
| `word other` | all words present (AND), in subject, body, from/to names, attachment filenames |
| `"exact phrase"` | phrase match |
| `-word`, `-from:x` | exclude |
| `a OR b`, `{a b}` | either |
| `( … )` | grouping |
| `from:` `to:` `cc:` `bcc:` | name or address; `from:amazon` matches `orders@amazon.com` and "Amazon.com" (tokenize addresses on `@ . - _ +`) |
| `subject:` | subject only |
| `label:x` | user or system label; spaces as `-` or quoted (`label:"Receipts 2019"`) |
| `in:inbox` `in:sent` `in:spam` `in:trash` `in:anywhere` | location |
| `is:starred` `is:important` `is:unread` `is:removed` | flags (`is:removed` = no longer in latest Takeout) |
| `category:promotions` etc. | Gmail tabs |
| `has:attachment` | any attachment |
| `filename:pdf` / `filename:report.pdf` | attachment name or extension |
| `after:` `before:` | `YYYY/MM/DD` or `YYYY-MM-DD`; `before:` is exclusive (Gmail behaviour) |
| `older_than:` `newer_than:` | `3d`, `2m`, `1y` |
| `larger:` `smaller:` | `5M`, `200K` |

- Like Gmail, **Spam and Trash are excluded** unless the query uses `in:spam`,
  `in:trash`, or `in:anywhere`.
- Matching is whole-word, case- and accent-insensitive, with no stemming.
- Unknown operators are treated as plain text, never as an error. An invalid
  date shows a subtle hint.
- Dates are interpreted in the Mac's local time zone.

From the terminal:

```sh
mail-cli search 'from:amazon has:attachment after:2020/01/01'
mail-cli search -- '-in:inbox label:receipts'
mail-cli bench        # latency percentiles only, no mail content
```

## Privacy

- The app CSP allows only the app itself and Tauri's local IPC. There is no
  updater and no HTTP client; `app/src-tauri/tests/lockdown.rs` enforces both.
- Message bodies are sanitized and rendered in a sandboxed frame with no
  scripts. Remote images, fonts and CSS are stripped, and the pane shows how
  many were blocked.
- Links open in your default browser, never inside the app.
- When you open an attachment, the app copies it to a private temp folder. The
  copy is marked as downloaded (quarantined), so macOS asks before running
  anything, and the folder is deleted when the app quits.

## Tests

```sh
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cd app && pnpm test && pnpm build
```

Benchmark results on a real archive (numbers only) are in
[docs/benchmarks.md](docs/benchmarks.md).
