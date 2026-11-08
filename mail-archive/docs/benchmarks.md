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
