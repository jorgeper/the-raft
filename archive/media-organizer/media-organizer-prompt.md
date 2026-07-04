# Media Organizer — Operating Prompt (v7)

The specification the `media_organizer.py` script is built from. Hand this to Claude (Cowork) to run,
resume, or re-run the process, or read it to understand exactly what the script does. Fill in the two
paths, then paste. To resume an interrupted run, jump to **"Resuming a run."**

"Media" = images, editable image/design files, camera raw, video, and audio. Every source file is
copied somewhere in the destination — nothing is skipped, nothing is deleted, bytes are never altered.

**Tooling:** Python + `Pillow` (image EXIF) and `ffprobe`/`ffmpeg` on PATH (video & audio dates).
Without them, those files fall back to filename/mtime dating.

**Changelog:** v7 — incremental re-runs: a per-library hash manifest (`_organizer/library.md5`) lets a
repeat run **skip files already imported** (copies only what's new); `--skip-library` also skips content
already imported under a different name/path. Added one-step `run` command and `processed_summary.py`.
v6 — corrupt and duplicate files now go to **separate** folders,
`untouched/<parent>/corrupt/` and `untouched/<parent>/duplicate/`. v5 — "untouched" tree for anything
nested >1 folder deep (copied as-is, mirroring source); events are now only single-level folders. v4 — "photo" → "media", audio in scope. v3 — video/ffprobe dates. v2 —
run tracking + resumability.

```
SOURCE (read-only, never modify anything in it): [SOURCE FOLDER]
DESTINATION (create everything here):            [DESTINATION FOLDER]
```

---

## Routing — where each source file goes (priority order)

Evaluate top to bottom; first match wins. `depth` = how many folders deep in the source (a file
directly in SOURCE is depth 0; in one subfolder, depth 1; deeper, depth 2+).

1. **Corrupt** (media that is zero-byte or unreadable) → `untouched/<original-parent-path>/corrupt/<name>`,
   or **duplicate** (media whose exact content already appears in a kept file) →
   `untouched/<original-parent-path>/duplicate/<name>`. Both copied unchanged, in their own folder.
2. **Nested more than one folder deep** (depth ≥ 2) → `untouched/<same relative path as source>`,
   copied unchanged. (This is what keeps deep sub-trees — e.g. `msft/OWA 2003 Themes/Earth/…` — intact
   instead of exploding them into events.)
3. **Not media** (depth ≤ 1) → `_not-media/<relative path>`, copied unchanged.
4. **Media, depth ≤ 1, with a date** → organized: `YYYY/MM - Month/[event-subfolder/]YYYY-MM-DD-slug.ext`.
5. **Media, depth ≤ 1, no derivable date** → `_needs-review/<relative path>`, copied unchanged.

Duplicate detection runs only across the *placeable* set (media, depth ≤ 1); the first occurrence
(sorted by path) is kept and organized, the rest are routed to `untouched/…/duplicate/`. Files under
`untouched/` (nested) are copied verbatim and are not de-duplicated.

---

## Scope — what counts as media

- Images: `jpg, jpeg, png, gif, bmp, tif, tiff, heic, heif, webp`
- Editable image/design files: `psd, psp, eps, ico`
- Camera raw: `cr2, cr3, nef, arw, dng, raf, orf, rw2, pef, srw`
- Video: `mov, mp4, m4v, avi, 3gp, mkv, wmv, asf, mts, m2ts, mpg, mpeg, flv, webm, ogv`
- Audio: `m4a, mp3, wav, aac, ogg, flac, wma, m4b, aiff, opus`

Guiding principle (overrides the list): a clearly image/design/video/audio format is media even if its
extension is missing above. Anything else (documents, archives, `.DS_Store`, …) is not media.

---

## Target structure

```
DESTINATION/
  2011/
    02 - February/
      2011-02-12-sunset.jpg
      2011-02-26-karen-brad-corinne-san-sebastian-madrid/   # single-level event folder
        2011-02-26-001.jpg
  _not-media/            documents etc., original relative paths
  _needs-review/         datable-but-undated media, original relative paths
  untouched/             nested (>1 deep) copied as-is, mirroring source
    work/logos/final/deep.jpg
    <parent>/corrupt/<name>       corrupt (zero-byte/unreadable) files, as-is
    <parent>/duplicate/<name>     duplicate files, as-is
  _organizer/            run tracking (see below)
```

- Top level: one folder per year. Inside: `MM - MonthName`. Media renamed `YYYY-MM-DD-slug.ext`.

---

## Date rules (priority order — record `date_source` and `date_confidence` in the manifest)

1. **Embedded capture timestamp** → **high**. Images: EXIF `DateTimeOriginal`. Video & audio:
   container metadata via `ffprobe` (`com.apple.quicktime.creationdate` → `date` tag → `creation_time`),
   validated the same way as mtime (skip if implausible or identical to the minute across 20+ files).
2. **Filename date** incl. `IMG-YYYYMMDD-WA*`, `VID-YYYYMMDD-WA*`, `Screenshot_YYYYMMDD*`,
   `PXL_YYYYMMDD*`, `VID_YYYYMMDD_HHMMSS`, `YYYYMMDD_HHMMSS`, `YYYY-MM-DD` → **high**.
3. **Sidecar** (`.json` Takeout `photoTakenTime`, or `.xmp`) → **high**.
4. **Sequence inference** from adjacent-numbered neighbours with tier 1–3 dates → **medium** (earlier
   of disagreeing neighbours → **low**).
5. **Validated file mtime**, unless it is a bulk-copy artifact (20+ files share a mtime-minute in the
   folder) or implausible → **medium**.
6. **Folder-month** from a parent name like `March 2019` / `2019-03` / a bare year → `YYYY-MM-00` → **low**.
7. Nothing applies → `_needs-review/`.

In the summary, report counts per tier and list folders where tier-5 mtimes were rejected as bulk-copy
artifacts.

---

## Events

A single-level source folder (depth 1) whose name looks like a theme/event (`bachelor party`,
`marce, wedding`, `karen, hawaii`) becomes one subfolder `YYYY-MM-DD-event-slug` in the month of its
**earliest** placed photo, holding all that folder's placed media (each renamed to its own date).
Generic containers are not events: `New Folder, Camera Roll, DCIM, 100APPLE, export, misc, photos,
images, pictures, Original size, Social media, Zip, Video`, and date/number-only names. Deeper folders
(depth ≥ 2) are never events — they go to `untouched/`.

---

## Naming

- Slug: lowercase, hyphen-separated words; strip camera/clip prefixes (`IMG_`, `DSC_`, `DSCF`, `DCP`,
  `PXL_`, `VID`, `MVI_`, `GOPR`, `Picture`, `Image`, …) and copy-suffixes (`(1)`, `_copy`).
- Pure camera/clip codes or numbers → `YYYY-MM-DD-NNN.ext` (per-day counter).
- Keep original extension, lowercased. Never re-encode. Collisions get `-01`, `-02`.

---

## Run tracking

Everything is recorded under `DESTINATION/_organizer/`:

```
_organizer/
  ledger.csv                 one row per run (id, timestamps, source, dest, phase, counts)
  runs/<run_id>/
    plan.csv                 the manifest: source_path, proposed_destination, route, date_used,
                             date_source, date_confidence, tier, event_folder, md5, notes
    summary.md               human-readable summary
    state.json               machine state (phase, totals, paths)
    copied.log               append-only; one verified copy per line
```

`run_id` = start time `YYYYMMDD-HHMMSS`. Phases: `planning → awaiting-approval → copying → completed`
(`interrupted` if a copy stops midway).

---

## Process

1. **Plan (dry run):** scan, build `plan.csv` + `summary.md`, set phase `awaiting-approval`. Present
   the summary. **Stop and wait for approval.**
2. **Execute (after approval):** copy per manifest; after each byte-verified copy, append to
   `copied.log`. Never overwrite a source; never delete.
3. **Verify & close:** confirm every planned file is present; spot-check 10 random copies are
   byte-identical to their sources; set phase `completed`; report.

---

## Resuming & re-running

The copy step is idempotent. Say **"Resume the media organizer"** (optionally a `run_id`). It reloads
`plan.csv` + `copied.log` and, for each planned file, skips it if already logged and the destination
hash matches, otherwise copies and verifies it. An interruption at any point is safe — re-running
finishes exactly the remaining files and never re-copies a correct one.

**Incremental re-runs:** each library keeps a manifest of imported content hashes at
`_organizer/library.md5`. On a repeat run over the same (or overlapping) source, a file is skipped when
its content is already in the manifest and its copy still exists — so re-running only picks up new
files. With `--skip-library`, a file is skipped if its content was imported before under any name or
path. The manifest is built on the first run, so skipping applies from the second run onward.

---

## Absolute rules

- SOURCE is read-only. Never modify, move, or delete anything in it.
- Never delete anything, anywhere. Copy only. Every source file lands somewhere in DESTINATION.
- Never re-encode or alter media bytes (extensions may be lowercased).
- Always dry-run and get explicit approval before the first copy of a run.
```
