# Media Organizer

A tool that takes a messy folder of photos, videos, and audio and copies everything into a clean,
dated library — **without ever changing or deleting the originals**.

This folder contains:

| File | What it is |
|---|---|
| `media_organizer.py` | The program that does the work. Runs locally, no internet needed. |
| `media-organizer-prompt.md` | The plain-English spec the program is built from. Read it if you want the exact rules. |
| `README.md` | This file. |

You have **two ways to run it** — through Cowork (just talk to Claude) or by running the Python
script yourself. Both do the same thing. Pick based on the situation:

- **A few hundred files, or you want help/oversight?** → Use **Cowork** (Option A).
- **Thousands of files / a huge folder / you want it free and fast?** → Run the **script** (Option B).
  Big jobs through Cowork cost a lot of tokens; the script costs nothing.

---

## What it actually does (the short version)

It looks at every file in a SOURCE folder and copies it into a DESTINATION folder like this:

```
DESTINATION/
  2011/
    02 - February/
      2011-02-12-sunset.jpg                         <- renamed to its date
      2011-02-26-karen-hawaii/                       <- a "single folder" of photos becomes an event
        2011-02-26-001.jpg
  _not-media/        <- documents, .DS_Store, etc. (copied as-is)
  _needs-review/     <- photos it couldn't find a date for (copied as-is)
  untouched/         <- see below
  _organizer/        <- bookkeeping: a record of every run (ignore unless curious)
```

**How it decides a file's date** (best source first): embedded EXIF / video / audio metadata → a date
in the filename → a sidecar `.json`/`.xmp` → inference from neighbouring files → the file's modified
date → a year/month from the folder name. Each file's date source and confidence are written to the
plan so you can see how it was decided.

**The `untouched/` folder** is where it plays it safe:
- Anything buried **more than one folder deep** in the source is copied to `untouched/` with the exact
  same structure — not renamed, not reorganized.
- Anything **corrupt** (zero-byte / unreadable) goes to `untouched/<original folder>/corrupt/`, and any
  **duplicate** of a photo it already placed goes to `untouched/<original folder>/duplicate/` — two
  separate folders so you can tell them apart.

So nothing is ever lost or guessed at aggressively — if in doubt, it's preserved as-is.

**Safety guarantees:** the source is only ever read; nothing anywhere is deleted; image/video/audio
bytes are copied exactly (never re-encoded); and every file lands somewhere in the destination.

---

## Option A — Run it through Cowork (talk to Claude)

1. Open Cowork and make sure Claude has access to your **source** folder and your **destination**
   folder (it will ask to connect them if not).
2. Say something like:

   > Organize my photos. Source: `Z:\path\to\messy photos`. Destination: `Z:\path\to\clean library`.
   > Follow the media-organizer spec in `Z:\src\media-organizer\media-organizer-prompt.md`.

3. Claude does a **dry run** first and shows you a summary (how many files, how they'd be dated, which
   are events, duplicates, etc.) plus a `plan.csv`. **Nothing is copied yet.**
4. Look it over. If it's good, say **"approved, go ahead."** Claude copies everything and then verifies
   the copies are byte-identical to the originals.
5. If it ever gets interrupted, just say **"resume the media organizer"** and it picks up where it
   stopped.

Tip: for a very large folder, Claude may tell you it's cheaper to run the script (Option B). It can
still set everything up and hand you the exact command.

---

## Option B — Run the Python script yourself (free, best for big jobs)

Everything below is copy-paste ready. **Keep the double-quotes** — your folder paths have spaces in them.
Replace only the folder paths inside the quotes.

- `SRC` = the messy folder you want to organize. It is **only ever read** — never changed.
- `DST` = the folder where the clean library gets built. Can be brand-new/empty, or reused across runs.
- If `python` isn't recognized, try `py` instead of `python`.

### One-time setup (do this once)

1. Install Python 3 from https://www.python.org/downloads/ (tick "Add Python to PATH" during install).
2. Install the helpers:
   ```
   pip install pillow rich
   ```
   `pillow` reads dates out of photos; `rich` gives you the live progress bar, spinner, and
   folder-by-folder status while it runs. `rich` is optional — without it you still get plain-text
   progress lines (and you can force plain mode any time by setting the `MO_NO_RICH` environment
   variable).
3. (Optional but recommended) Install **ffmpeg** so it can read dates from videos and audio:
   - Easiest on Windows: `winget install Gyan.FFmpeg`
   - Or download from https://www.gyan.dev/ffmpeg/builds/ and add its `bin` folder to your PATH.
   - Skip it and the tool still works — videos/audio just fall back to filename/modified-date.
4. Check it's ready (should each print a version):
   ```
   python --version
   ffprobe -version
   ```

### The simplest way — one command (plan + copy + verify)

Use `run` when you just want it done. It scans, copies, and verifies in a single step:

```
python "Z:\src\media-organizer\media_organizer.py" run --source "Z:\messy photos" --dest "Z:\clean library"
```

That's it. When it finishes you'll have `Z:\clean library` filled with `YYYY\MM - Month\` folders,
plus `untouched\`, `_needs-review\`, and a `_organizer\` log. Nothing in the source is touched.

### The careful way — look before you copy (two steps)

If you'd rather review first, split it into `plan` (copies nothing) then `execute`:

```
1)  python "Z:\src\media-organizer\media_organizer.py" plan --source "Z:\messy photos" --dest "Z:\clean library"
```
Then open the two files it made and check the `proposed_destination` / `route` columns:
```
    Z:\clean library\_organizer\runs\<run_id>\summary.md     (readable overview)
    Z:\clean library\_organizer\runs\<run_id>\plan.csv       (every file and where it would go)
```
When happy:
```
2)  python "Z:\src\media-organizer\media_organizer.py" execute --dest "Z:\clean library"
```

### If it gets interrupted (closed laptop, lost power, etc.)

Just run `resume` — it skips everything already copied and finishes the rest:
```
python "Z:\src\media-organizer\media_organizer.py" resume --dest "Z:\clean library"
```

### Do several source folders into one library

Run `run` once per source, all pointing at the same `--dest`:
```
python "Z:\src\media-organizer\media_organizer.py" run --source "Z:\folder one"   --dest "Z:\clean library"
python "Z:\src\media-organizer\media_organizer.py" run --source "Z:\folder two"   --dest "Z:\clean library"
```
Each run is logged separately and files are de-duplicated against what's already there.

### Re-running / adding new photos (incremental — it skips what it already has)

You can safely re-run the same source into the same library. It keeps a record of everything it has
already imported (`DST\_organizer\library.md5`) and **skips files it already copied** — so a second
run only picks up what's new, instead of re-copying everything.

- **Default:** a file is skipped if its content was already imported **and** its copy is still in the
  library. Perfect for "I dropped some new photos into the same folder, run it again."
  ```
  python "Z:\src\media-organizer\media_organizer.py" run --source "Z:\messy photos" --dest "Z:\clean library"
  ```
- **`--skip-library`:** also skips a file if that exact photo was imported before **under any name or
  path** — useful if you renamed or moved things in the source and don't want a second copy.
  ```
  python "Z:\src\media-organizer\media_organizer.py" run --source "Z:\messy photos" --dest "Z:\clean library" --skip-library
  ```

(The very first run builds the record, so the skipping kicks in from the second run onward.)

### Check a copy is complete — and explain size differences

If a destination looks bigger (or smaller) than you expect, `verify` compares the two folders **by
file content** (not by name, since the organizer renames files) and tells you the delta:

```
python "Z:\src\media-organizer\media_organizer.py" verify --source "Z:\messy photos" --dest "Z:\clean library"
```

It reports three things and writes the full list (largest first) to `DST\_organizer\verify-<timestamp>.csv`:

- **MISSING from destination** — source content that isn't in the destination. Should be zero; if not,
  something didn't copy.
- **EXTRA in destination** — content that isn't in the source at all (e.g. files from a different
  source, or an earlier run).
- **DUPLICATE copies in destination** — the same photo stored more than once, inflating the size.

Add `--quick` for a much faster compare on large libraries (uses a size + partial-hash signature
instead of hashing every full file):

```
python "Z:\src\media-organizer\media_organizer.py" verify --source "Z:\messy photos" --dest "Z:\clean library" --quick
```

### See what you've processed so far

```
python "Z:\src\media-organizer\processed_summary.py" --dest "Z:\clean library"
```
Prints every run, its source folder, status, and where the files went (placed / untouched / duplicate /
corrupt / not-media / needs-review), plus totals. Add more `--dest "..."` to summarize several libraries
at once.

---

## The commands at a glance

| Command | What it does |
|---|---|
| `run --source SRC --dest DST` | **One step:** scan, copy, and verify. Simplest option. Skips files already imported. |
| `run ... --skip-library` | Same, but also skips photos already imported under a different name/path. |
| `plan --source SRC --dest DST` | Scan and build a plan only. **Copies nothing.** For reviewing first. |
| `execute --dest DST` | Copy everything from the latest plan, then verify. |
| `resume --dest DST` | Finish an interrupted copy (safe to run anytime). |
| `status --dest DST` | Quick one-line-per-run list. |
| `verify --source SRC --dest DST` | Content diff: missing / extra / duplicate files (add `--quick` for speed). |
| `processed_summary.py --dest DST` | Readable report of all sources processed into a library. |

Every run is recorded under `DST\_organizer\`, so you can always come back and see what happened.

---

## FAQ / troubleshooting

**Will it touch my originals?** No. The source is opened read-only. Nothing is ever deleted anywhere.

**It said `ffprobe` not found.** Videos/audio will just be dated by filename or modified-date instead.
Install ffmpeg (see setup) if you want the best dates.

**A lot of files went to `_needs-review`.** Those are photos with no reliable date signal (often because
their modified-dates looked like a bulk copy). They're safe in `_needs-review/` with their original
folder structure — you can sort them by hand or re-date them and run again.

**Why are some things in `untouched/`?** They were either nested more than one folder deep, corrupt, or
duplicates — so the tool preserved them exactly rather than guess. Look there if a file seems "missing"
from the year/month tree.

**Can I change the rules?** Yes — the exact behavior is described in `media-organizer-prompt.md`, and
the logic lives near the top of `media_organizer.py` (the extension lists and the `assign_destinations`
function). Or just ask Claude in Cowork to adjust it.
