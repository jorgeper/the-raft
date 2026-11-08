# Mail Archive — design

Date: 2026-11-07 · Status: draft for review · Working name: **mail-archive**

## 1. Intent

A fast, fully local macOS app for **searching and reading an archive of my Gmail**,
built from Google Takeout exports. The everyday moment: "I need that old email" —
type a Gmail-style query (keywords, from/to, dates…), get results instantly, and
read the conversation. Browsing is what happens after a search, not a separate
mode.

"Native" here means **fast and runs locally**, not "uses Apple's UI controls".

## 2. Goals

1. Search ~24 GB of mail (one Takeout mbox, likely several hundred thousand
   messages) with a Gmail-like query language; results appear as you type.
2. Read results comfortably: conversation view, HTML emails rendered faithfully
   (minus remote content), attachments openable/savable.
3. Ingest future Takeouts incrementally: add only new mail, update labels on
   existing mail, never duplicate, never lose mail.
4. Everything stays on this Mac.

## 3. Non-goals

- Sending, replying, forwarding, composing, drafts.
- Syncing with Gmail / IMAP / any API. The only input is Takeout files.
- Editing mail: no deleting, labeling, starring, or marking read inside the app.
- Multiple accounts, other platforms (Windows/Linux/iOS), sharing.
- Contacts, calendar, chat, or other Takeout products.
- Native AppKit/SwiftUI look and feel.

## 4. Anti-goals (fail even if it "works")

- **Any network traffic.** Opening a 2014 newsletter must not ping the sender's
  tracking pixel today. No telemetry, update checks, crash reporters, CDN fonts,
  remote images, link prefetching.
- **Mail data synced to the cloud by accident.** The library must not live in
  Dropbox/iCloud by default.
- **Losing mail on update.** A message once imported is never removed by a later
  import, even if Gmail no longer has it.
- **Sluggishness.** If search feels slower than Gmail's, the app has failed its
  reason to exist.

## 5. Constraints and decided "how"

| Decision | Who decided |
|---|---|
| macOS app, fast, local-only | owner |
| Gmail-style query language in a single search box | owner |
| Layout "C · Search-first" (see §8) | owner (picked from mockups) |
| Future Takeouts must be diffed in; ability to re-index | owner |
| Mail deleted from Gmail but present in the library is **kept** | owner |
| **Tauri 2** app: Rust core + web-view UI | my call, owner agreed ("fast and runs locally" is what matters) |
| **Tantivy** for full-text search, **SQLite** for metadata | my call |
| App keeps its own compressed message store; Takeout files not needed after import | my call |
| Project lives at `~/src/mail-archive` (outside Dropbox), git repo | owner |
| No app-level encryption at rest; FileVault + permissions suffice | owner |

## 6. Source data (verified against the actual Takeout)

- Takeout arrives as several zips. The mail is a single entry:
  `Takeout/Mail/All mail Including Spam and Trash.mbox` (~24.5 GB uncompressed,
  inside a ~14 GB zip → zip64). Other zips hold `User Settings/Filters.json`,
  `Blocked Addresses.json`, `archive_browser.html` — ignored.
- Format: mbox; each message begins with a `From <digits>@xxx <date>` line.
  Body lines starting with `From ` are `>`-escaped (treat as mboxrd).
- Every message carries:
  - `X-GM-THRID: <int>` — Gmail conversation id → used for threading.
  - `X-Gmail-Labels: a,b,c` — comma-separated. Mix of system labels
    (`Inbox`, `Sent`, `Starred`, `Important`, `Spam`, `Trash`, `Unread`,
    `Opened`, `Draft`, `Category Promotions`, `Category Updates`, …) and user labels.
    Labels can contain spaces; parse defensively (quotes, non-ASCII).
- `Message-ID` is present on most but not all messages (header case varies:
  `Message-ID` / `Message-Id`).
- Sample: ~65 KB average per message including attachments.

## 7. Architecture

```
Takeout zip(s) ──stream──▶ Importer (Rust) ──▶ Library
                                              ├─ store/   append-only zstd packs (raw RFC 822 bytes)
                                              ├─ meta.sqlite  messages, threads, labels, attachments, imports
                                              └─ index/   Tantivy full-text index
UI (web view) ◀── Tauri commands (IPC only) ──▶ Query engine (Rust)
```

### 7.1 Library

- Default location: `~/Library/Application Support/mail-archive/library/`.
  First-run lets you choose another folder; warn if the chosen path is inside
  Dropbox, iCloud Drive, Google Drive, or OneDrive.
- **Message store:** raw message bytes (exactly as in the mbox, with the
  `From_` line removed and mboxrd un-escaping applied), zstd-compressed
  individually or in small frames, appended to pack files (~1 GB each). A message
  is addressed by `(pack_id, offset, length)`. Expected size: roughly 8–12 GB for
  the current archive.
- **Event log** (`store/events.log`, append-only, my call): one record per
  import (id, time, source, kind = full/partial) and per message label change
  (dedupe key, import id, new label set). The raw bytes plus this log are the
  source of truth: replaying them reproduces current labels,
  `first_seen_import`/`last_seen_import`, and `is:removed`. SQLite and the
  index are fully rebuildable caches.
- **meta.sqlite** (WAL mode). Indicative tables:
  - `messages(id, dedupe_key UNIQUE, message_id, thrid, date, from_name, from_addr, to/cc/bcc (normalized), subject, snippet, size, has_attachments, pack_id, offset, length, first_seen_import, last_seen_import)`
  - `labels(id, name)`, `message_labels(message_id, label_id)`
  - `attachments(message_id, part_index, filename, mime_type, size, content_id)`
  - `imports(id, started_at, source_paths, counts…, status)`
- **index/**: Tantivy index with fields for subject, body text (HTML → text),
  from/to/cc/bcc (names + addresses), filenames, labels, date, size, thread id,
  flags (attachment, starred, etc.). Store only the doc id in Tantivy; fetch
  display data from SQLite.

### 7.2 Import (first import and every later one)

1. User picks one or more Takeout zips (or an extracted `.mbox`). The importer
   finds the mbox entry and **streams it straight out of the zip** — no 24 GB
   extraction step.
2. **Scan phase (read-only):** parse each message, compute its dedupe key, and
   classify:
   - **new** — dedupe key not in library
   - **existing, labels changed**
   - **existing, unchanged**
   - Messages in the library but **absent** from this Takeout are counted
     ("deleted in Gmail since last import").
3. Show a summary and require confirmation, e.g.
   `412,330 already in library · 3,812 new · 1,140 label changes · 96 no longer in Gmail (kept)`.
4. **Apply phase:** append new messages to the store, insert metadata, add to
   the index; replace labels on changed messages and re-index them. Absent
   messages are kept untouched and marked (`last_seen_import` < latest import),
   which makes them searchable via `is:removed` (my call — cheap and useful).
5. Must be resumable/safe: a crash or quit mid-import leaves the library
   consistent (commit SQLite + index in batches; on restart, either resume or
   roll back the partial import). The store is append-only, so orphaned bytes are
   harmless.
6. Progress UI: messages processed, rate, ETA; cancellable.

**Dedupe (my call, refines what I told the owner):** store two keys per message
from day one and treat a match on **either** as "already have it":
1. `content_key` — SHA-256 of the raw message bytes with the mbox `From_` line
   and the `X-Gmail-Labels` / `X-GM-THRID` headers removed.
2. `header_key` — normalized `Message-ID` + `Date` + `From` address (null when
   `Message-ID` is missing).

Reason: `Message-ID` is sometimes missing or reused by badly behaved senders,
and we can't yet verify that Google exports byte-identical messages across
Takeouts (only one export exists today). Matching on either key avoids mass
duplication if bytes drift, and avoids false merges when Message-IDs collide
(a header-key match with a different content key is only accepted if the
`X-GM-THRID` also matches). Log counts of each match type per import so drift is
visible.

**Full vs partial exports (my call):** an import counts as **full** only when
the source is the `All mail Including Spam and Trash.mbox` entry. Only full
imports replace labels and update `last_seen_import` / `is:removed`. Any other
mbox (label-only exports, hand-made mboxes) is **partial**: it only adds new
messages and never changes existing labels. Guard rails for full imports:
- If its newest message is older than the library's newest, warn that it looks
  like an older export; if confirmed, add new mail only (no label rollback, no
  removals).
- If more than 5% of the library would be marked removed, show a prominent
  warning in the confirmation summary.

### 7.3 Re-index

- New mail is added to the index incrementally during import.
- A **Rebuild index** command (menu) rebuilds SQLite and the Tantivy index from
  the message store plus the event log (§7.1), with progress, without the Takeout.
  Used after app upgrades that change parsing/search, or after corruption.
- Store an index schema version; on mismatch at startup, prompt to rebuild.

### 7.4 Threading

- Group by `X-GM-THRID`. Fallback when missing: `References`/`In-Reply-To`,
  else the message is its own thread.

## 8. UI — layout "C · Search-first"

Single window. No label sidebar.

- **Search box** at top, large, focused on launch. Placeholder hints at syntax.
- **Filter chips** row under the box mirrors the parsed query
  (`from: delta ✕`, `after: 2018-01-01 ✕`, `📎 attachment ✕`). Box text and chips
  stay in sync both ways: ✕ removes that operator from the text; **+ label** /
  **+ date** open pickers that insert operators.
- **Autocomplete** for `label:` (real labels from the library) and `from:` /
  `to:` (addresses/names seen in the archive, ranked by frequency).
- **Results list** (left, ~40%): one row per **conversation** — sender(s),
  message count, subject, snippet, date, 📎 if any attachment. Newest matching
  message first. Search terms highlighted. Shows total count and query time.
  Virtualized: must handle tens of thousands of hits smoothly.
- **Empty query** shows most recent mail (excluding Spam/Trash), so launch isn't
  a blank screen.
- **Results update as you type**, debounced (~100 ms); stale queries are
  cancelled.
- **Reading pane** (right, ~60%): the selected conversation, messages stacked
  oldest→newest, the matching message(s) expanded and others collapsed (Gmail
  behaviour). Header: from, to, cc, date, labels. Search terms highlighted in
  body. Attachments shown as chips: click = open in default app (via a temp copy),
  secondary action = Save As….
- **Keyboard:** `⌘F` or `/` focuses search · `↑/↓` move through results and the
  pane follows · `Enter`/`→` focus the pane · `Esc` clears the search (or returns
  focus to results) · `⌘C` on a result copies subject+from+date.
- **Menu:** Import Takeout…, Rebuild Index, Show Library in Finder.

Visual polish (typography, colors, dark mode) is left to the builder; follow the
system light/dark setting.

## 9. Query language

Gmail-compatible subset. Case-insensitive operators; values may be quoted.

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
- Matching: whole-word, case- and accent-insensitive; no stemming (Gmail doesn't
  stem much either). Prefix match on the last word while typing is acceptable.
- Unknown operators are treated as plain text, never an error. Invalid dates show
  a subtle inline hint.
- Dates are interpreted in the Mac's local time zone.

## 10. Privacy & local-only enforcement

- Tauri CSP for the app UI: `default-src 'self'; img-src 'self' <custom-protocol>; connect-src ipc: ...` — nothing remote.
- No Tauri updater, no analytics, no remote fonts; bundle all assets.
- **Email bodies** render inside a sandboxed iframe (no scripts, no forms, no
  same-origin) with its own CSP that allows only inline styles and images served
  from the app's own protocol (`cid:` inline images resolved from the message).
  HTML is additionally sanitized in Rust (e.g. `ammonia`) — strip scripts, event
  handlers, `<link>`, `@import`, remote `url(...)` in CSS, `<iframe>`, `<object>`,
  meta refresh. Remote images are replaced by a neutral placeholder. **No
  "load images" button.**
- Links: shown with their real URL on hover; open in the default browser only on
  explicit click. No prefetch.
- Attachments opened via a temp copy in the app's cache dir, cleaned on quit.
- Library files written with user-only permissions (`0700` dirs / `0600` files).
- **No app-level encryption at rest** (owner's decision): rely on FileVault plus
  file permissions. Don't design for SQLCipher/encrypted packs.
- Logs never include message bodies or addresses.

## 11. Performance targets

Measured on the real archive on an Apple Silicon Mac:

- Typical query (keywords + 1–2 operators) → first results rendered: **< 100 ms**.
- Select a result → conversation rendered: **< 50 ms** (excluding giant HTML).
- Cold app launch to usable search: **< 1 s** after first import.
- Full first import of the 24 GB Takeout: target **< 30 min**; use all cores for
  parsing/indexing.
- Memory: steady state < 500 MB.

## 12. Testing

- Synthetic fixture mboxes checked into the repo (no real mail ever committed):
  multipart, HTML-only, odd charsets, missing Message-ID, `>From` escaping,
  labels with spaces/non-ASCII, inline `cid:` images, huge attachments.
- Query parser: table-driven tests for every operator, negation, OR, grouping,
  quoting.
- Import diff: import A, then A′ (new mail, label changes, deletions) → assert
  counts, no duplicates, nothing removed, labels updated, `is:removed` works.
  Also: A′ with re-folded headers (content key differs, header key matches) →
  no duplicates; partial import → no label changes or removals; older export →
  warning, no rollback.
- Rebuild from store + event log reproduces identical SQLite labels and
  `is:removed` as before the rebuild.
- Crash mid-import → library still consistent.
- Network lockdown: a test/CI check that rendering a fixture with remote
  images/CSS/fonts produces zero network requests.
- A benchmark command that runs a fixed query set against the real library and
  prints latencies (run locally only).

## 13. Left to the builder

- Frontend framework (suggestion: Svelte or plain TypeScript + Vite; keep it
  light), list virtualization approach, styling.
- MIME parsing crate (e.g. `mail-parser`), zip crate (must stream zip64
  entries), HTML-to-text, sanitizer, exact Tantivy schema/tokenizers.
- Pack file format details, batch sizes, concurrency model.
- How chips are rendered and edited, exact keyboard edge cases.
- App icon, name, signing (local unsigned build is fine to start).
- Ordering of the build (suggested: importer + store + SQLite → query engine →
  CLI to search → UI → incremental re-import → polish).
