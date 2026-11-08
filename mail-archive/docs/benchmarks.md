# Benchmarks

Numbers only — no message content. Machine: Apple M5, macOS, release build.

## 2026-11-08 — Task 12 real-data checkpoint (`mail-cli`)

Source: one Gmail Takeout (3 zips, mbox entry 24.5 GB uncompressed / 15.0 GB compressed).

### First import (`mail-cli import takeout-*.zip --yes`)

| Metric | Value | Target |
|---|---|---|
| Messages imported | 146,469 | — |
| Parse errors | 0 | — |
| Scan (diff) phase | ~1m14s (~2,000–2,500 msg/s) | — |
| Apply phase | 1m56s (~1,260 msg/s) | — |
| **Total wall time** | **3m10s** | < 30 min ✅ |
| Peak RSS during import | 1.0 GB | (steady-state target 500 MB applies to browsing) ⚠️ |

### Library on disk

| Part | Size |
|---|---|
| `store/` (zstd packs) | 14 GB |
| `index/` (Tantivy) | 207 MB |
| `meta.sqlite` | 144 MB |
| `events.log` | 46 MB |
| **Total** | **~15.4 GB** (spec estimate was 8–12 GB) ⚠️ |

### Search (`mail-cli bench`, 20 queries × 5 runs after warm-up)

| Metric | Value | Target |
|---|---|---|
| p50 | 0.6 ms | — |
| p95 | 1.5 ms | < 100 ms ✅ |
| max | 2.7 ms (`"thank you"` phrase) | — |
| bench process peak RSS | 28 MB | < 500 MB ✅ |

### Follow-ups

- Store is ~57% of the raw mbox — larger than estimated, mostly base64 attachments compressed per message at zstd level 3. Options: higher level, a trained dictionary, or decoding base64 attachment parts before compressing. Not a blocker.
- Import peak RSS 1.0 GB (Tantivy writer budget 256 MB + parse batches + mapped index pages). Within reason for a one-off import; measure again in the app.

## 2026-11-08 — Task 18 acceptance (release build)

Same Takeout as above (3 zips, 146,469 messages). Release `mail-cli` and the
`Mail Archive.app` bundle (20.5 MB, unsigned).

### Import, re-import, rebuild

| Check | Result | Target |
|---|---|---|
| Fresh import into an empty library | 146,469 added · 0 parse errors · 4m26s wall · peak RSS 0.80 GB | < 30 min ✅ |
| Re-import the same Takeout | **0 added · 0 relabelled · 0 marked removed** · 0 parse errors · 2m15s wall · peak RSS 0.88 GB | 0 / 0 / 0 ✅ |
| `rebuild` | 50 s · 0 parse errors · 0 inconsistencies · peak RSS 0.77 GB | completes ✅ |
| Results after rebuild vs fresh import (20 bench queries, up to 5,000 threads each) | identical counts, sets and order, 20/20 | unchanged ✅ |

Library: store 14 GB, index 213 MB, meta.sqlite 144 MB, events.log 46 MB.

Before the fix in `9460b4e`, the result sets already matched, but up to 20
same-date threads per query came back in a different order after a rebuild.
That fix makes ordering deterministic (date, then thread id, then message id).
It changes one query's 5,000-message cutoff by one thread (`older_than:5y`
3,792 → 3,793 threads).

### Search latency (`mail-cli bench`)

| Build | p50 | p95 | max | Target |
|---|---|---|---|---|
| Before the tie-break fix | 0.6 ms | 1.5 ms | 2.6 ms | p95 < 100 ms ✅ |
| After the tie-break fix (`9460b4e`) | 0.6–0.8 ms | 3.2–5.6 ms | 3.8–11.3 ms | p95 < 100 ms ✅ |
| Final (`74d65d5`) | 0.6 ms | 2.5 ms | 3.1 ms | p95 < 100 ms ✅ |

The slowest queries are now the broad ones: empty, `in:inbox` and
`"thank you"`: about 3–4 ms in the first run after the fix, 3.1 ms max in the final run.

### App (scripted checks only)

| Check | Result | Target |
|---|---|---|
| Launch to process running | 0.1 s | — |
| Network while launched on the real library, 30 s idle on the first screen: app process plus its 3 WebKit helpers (GPU, WebContent, Networking), sampled every second with `lsof -i` | **0 sockets** | zero ✅ (launch only) |
| RSS right after launch | app 80 MB; WebKit helpers ≈ 46 MB | < 500 MB ✅ (launch only) |

Not yet measured; these need a person at the window:
- cold launch to typed query (< 1 s)
- opening a conversation (< 50 ms)
- memory after 10 minutes of browsing (< 500 MB)
- zero outbound connections while opening 20 HTML-heavy emails
- link clicks opening the default browser

They are listed in the hand-off checklist.
