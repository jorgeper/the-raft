# Media Organizer

A tool that takes a messy folder of photos, videos, and audio and copies everything into a clean,
dated library — **without ever changing or deleting the originals**.

This folder contains:

| File | What it is |
|---|---|
| `media_organizer-fable.py` | **The current organizer — use this one.** Bug-fixed successor to the original (see "What's new" below). |
| `library_fixer-fable.py` | Repairs a library built with the *original* script (wrong-year files, broken names). Scan / fix / revert. |
| `media_organizer.py` | The original v5 organizer. Kept for reference; superseded by the fable version. |
| `processed_summary.py` | Readable report of every run recorded in a library. |
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
  2023/
    07 - July/
      2023-07-04-beach.phone.jpg                     <- ".phone" = shot on a phone (searchable)
  _phone-misc/       <- screenshots & WhatsApp/messaging saves, dated but out of the timeline
  _not-media/        <- documents, .DS_Store, etc. (copied as-is)
  _needs-review/     <- photos it couldn't find a date for (copied as-is)
  untouched/         <- see below
  _organizer/        <- bookkeeping: a record of every run (ignore unless curious)
```

**How it decides a file's date** (best source first): embedded EXIF / video / audio metadata → a date
in the filename → a sidecar `.json`/`.xmp` → inference from neighbouring files → the file's modified
date → a year/month from the folder name. Each file's date source and confidence are written to the
plan so you can see how it was decided.

**Event folders:** a single-level source folder with a meaningful name ("Karen Hawaii") becomes an
event folder in the library. Files join the event only if their date is within `--event-span-days`
(default 31) of the folder's typical date — a file whose date is years off (usually a bad
modified-time) is filed under **its own** year/month instead of dragging the event, or being dragged,
into the wrong year. (The original script used the folder's *earliest* date and claimed every file,
which is how 2016-named files could end up under `2014/` — `library_fixer-fable.py` repairs that.)

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

## What's new in `media_organizer-fable.py` (vs the original)

- **A locked or unreadable file no longer kills the run.** It's logged as FAILED and the run
  continues; `resume` retries it later. (The original crashed and could never get past it.)
- **No more silent overwrites.** Name collisions are re-checked until a genuinely free name is found.
- **Wrong-year events fixed.** Events anchor on their *median* date and only claim files within
  `--event-span-days` (default 31); far-off strays are filed by their own date.
- **`verify` now lists MISSING files by name** in its CSV report (before it only counted them).
- **Non-Latin filenames** (e.g. Chinese) become numbered names like `2020-05-08-001.jpg` instead of
  the broken `2020-05-08-.jpg`; accented names are transliterated (`cumpleaños` → `cumpleanos`).
- **Smarter incremental re-runs.** The import record remembers *where* each photo went, so re-running
  after adding files doesn't re-copy things whose numbered names shifted.
- **Progress shows destination folders** — each `YYYY/MM - Month` or event folder is announced the
  first time a file is copied into it, so you can watch the library take shape.
- **Phone tagging.** Photos/videos shot on a phone get a `.phone` token before the extension
  (`2023-07-04-beach.phone.jpg`). Type `.phone.` in Explorer's search box for a phone-only view,
  `kind:video` for videos-only, or combine them. Detection uses the camera Make/Model embedded in
  the file (Apple, Google, Samsung phones, ...), the HEIC format, and phone filename patterns.
  Disable with `--no-phone-tag`.
- **Phone junk quarantine.** Screenshots and WhatsApp/messaging saves go to
  `_phone-misc/YYYY/MM - Month/` — still dated, renamed and preserved, but out of your main
  timeline, and they can't drag an event to the wrong date. Disable with `--no-junk-quarantine`.
- **HEIC dates** (iPhone photos) work when `pillow-heif` is installed; guards against source and
  destination overlapping; `--min-year` flag (default 1995) for pre-1995 collections; reads Google
  Takeout `*.supplemental-metadata.json` sidecars; assorted smaller fixes.

Same commands, same plan/execute flow, same output layout — it's a drop-in replacement.

---

## Quick start — a fresh run with all the new features

The recommended path, whether you're starting from zero or rebuilding a library you made with the
original script. Four steps:

**0. One-time setup** (so iPhone HEIC photos get real dates and phone detection works):
```
pip install pillow pillow-heif rich
```

**1. Organize into a brand-new, empty folder.** If you have an old library, do **not** reuse its
folder — the layout changed between versions and mixing them creates duplicates:
```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" run --source "Z:\messy photos" --dest "Z:\clean library v2"
```
Everything is on by default: `.phone` tagging, `_phone-misc` junk quarantine, the 31-day event
window, and per-file failure tolerance. You'll see each destination folder announced as it's
created. If some files were locked (cloud placeholders, open apps), the run finishes anyway and
lists them as FAILED — then just run:
```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" resume --dest "Z:\clean library v2"
```

**2. Verify it's content-complete** (compares by content, expects **MISSING: 0**):
```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" verify --source "Z:\messy photos" --dest "Z:\clean library v2"
```

**3. Retire the old library (if you had one).** Rename it (e.g. `clean library` →
`clean library OLD`) and keep it until you've lived with the new one for a while — your source
originals are untouched either way, so nothing is at risk. Delete the old copy whenever you're
comfortable.

Then browse:
- `.phone.` in Explorer's search box → only phone shots
- `kind:video` → only videos (`.phone. kind:video` → phone videos)
- `_phone-misc\` → screenshots and WhatsApp saves, organized by date

---

## Option A — Run it through Cowork (talk to Claude)

1. Open Cowork and make sure Claude has access to your **source** folder and your **destination**
   folder (it will ask to connect them if not).
2. Say something like:

   > Organize my photos. Source: `Z:\path\to\messy photos`. Destination: `Z:\path\to\clean library`.
   > Follow the media-organizer spec in `Z:\src\sandbox\media-organizer\media-organizer-prompt.md`.

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
   pip install pillow pillow-heif rich
   ```
   `pillow` reads dates out of photos; `pillow-heif` adds iPhone HEIC photos; `rich` gives you the
   live progress bar, spinner, and folder-by-folder status while it runs. `pillow-heif` and `rich`
   are optional — without them HEIC falls back to filename/modified-date and you get plain-text
   progress lines (you can force plain mode any time by setting the `MO_NO_RICH` environment variable).
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
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" run --source "Z:\messy photos" --dest "Z:\clean library"
```

That's it. When it finishes you'll have `Z:\clean library` filled with `YYYY\MM - Month\` folders,
plus `untouched\`, `_needs-review\`, and a `_organizer\` log. Nothing in the source is touched.

Useful knobs (all optional):
- `--event-span-days 31` — how far a file's date may sit from its event folder's typical date and
  still join the event. Raise it for month-long trips; lower it for tighter grouping.
- `--min-year 1995` — dates before this year are treated as implausible. Lower it if you're
  organizing scanned pre-1995 photos with real dates in their names.
- `--no-phone-tag` — don't add the `.phone` token to phone-shot files.
- `--no-junk-quarantine` — keep screenshots/WhatsApp saves in the main timeline instead of `_phone-misc/`.

### Browsing by kind once it's organized

- **Only videos:** type `kind:video` in Explorer's search box (works over the whole library), or add
  the Type column / group by Type in any folder.
- **Only phone photos:** type `.phone.` in the search box.
- **Only phone videos:** `.phone. kind:video`.
- **Screenshots & WhatsApp stuff:** it's all in `_phone-misc/`, organized by date.

### The careful way — look before you copy (two steps)

If you'd rather review first, split it into `plan` (copies nothing) then `execute`:

```
1)  python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" plan --source "Z:\messy photos" --dest "Z:\clean library"
```
Then open the two files it made and check the `proposed_destination` / `route` columns:
```
    Z:\clean library\_organizer\runs\<run_id>\summary.md     (readable overview)
    Z:\clean library\_organizer\runs\<run_id>\plan.csv       (every file and where it would go)
```
When happy:
```
2)  python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" execute --dest "Z:\clean library"
```

### If it gets interrupted (closed laptop, lost power, etc.)

Just run `resume` — it skips everything already copied and finishes the rest (including anything
that FAILED with a locked/unreadable file the first time):
```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" resume --dest "Z:\clean library"
```

### Do several source folders into one library

Run `run` once per source, all pointing at the same `--dest`:
```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" run --source "Z:\folder one"   --dest "Z:\clean library"
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" run --source "Z:\folder two"   --dest "Z:\clean library"
```
Each run is logged separately and files are de-duplicated against what's already there.

### Re-running / adding new photos (incremental — it skips what it already has)

You can safely re-run the same source into the same library. It keeps a record of everything it has
already imported (`DST\_organizer\library.md5`, now including where each file went) and **skips files
it already copied** — so a second run only picks up what's new, instead of re-copying everything.

- **Default:** a file is skipped if its content was already imported **and** its copy is still in the
  library. Perfect for "I dropped some new photos into the same folder, run it again."
  ```
  python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" run --source "Z:\messy photos" --dest "Z:\clean library"
  ```
- **`--skip-library`:** also skips a file if that exact photo was imported before **under any name or
  path** — useful if you renamed or moved things in the source and don't want a second copy.
  ```
  python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" run --source "Z:\messy photos" --dest "Z:\clean library" --skip-library
  ```

(The very first run builds the record, so the skipping kicks in from the second run onward.)

### Check a copy is complete — and explain size differences

If a destination looks bigger (or smaller) than you expect, `verify` compares the two folders **by
file content** (not by name, since the organizer renames files) and tells you the delta:

```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" verify --source "Z:\messy photos" --dest "Z:\clean library"
```

It reports three things and writes the full list (largest first) to `DST\_organizer\verify-<timestamp>.csv`:

- **MISSING from destination** — source content that isn't in the destination, listed by source path.
  Should be zero; if not, something didn't copy.
- **EXTRA in destination** — content that isn't in the source at all (e.g. files from a different
  source, or an earlier run).
- **DUPLICATE copies in destination** — the same photo stored more than once, inflating the size.

Add `--quick` for a much faster compare on large libraries (uses a size + partial-hash signature
instead of hashing every full file):

```
python "Z:\src\sandbox\media-organizer\media_organizer-fable.py" verify --source "Z:\messy photos" --dest "Z:\clean library" --quick
```

### See what you've processed so far

```
python "Z:\src\sandbox\media-organizer\processed_summary.py" --dest "Z:\clean library"
```
Prints every run, its source folder, status, and where the files went (placed / untouched / duplicate /
corrupt / not-media / needs-review), plus totals. Add more `--dest "..."` to summarize several libraries
at once.

---

## Repairing a library built with the ORIGINAL script

If you organized with `media_organizer.py` (v5), your library may have two kinds of damage:

- **Files under the wrong year** — e.g. a `2014/` folder containing `2016-…`-named photos. The old
  script parked a whole event under the folder's *earliest* date, so one mis-dated file (or a source
  folder mixing years) put files years away from where their names say they belong.
- **Broken names** from non-Latin filenames: files like `2020-05-08-.jpg` and event folders like
  `2014-02-26-` (nothing after the date).

`library_fixer-fable.py` repairs both, in place, with a full undo log. Three steps:

**1. Scan (changes nothing — always start here):**
```
python "Z:\src\sandbox\media-organizer\library_fixer-fable.py" scan --dest "Z:\clean library"
```
Prints how many strays and broken names it found, and writes the complete list to
`DST\_organizer\fixes\<id>\fixplan.csv` so you can review every proposed move.

**2. Fix:**
```
python "Z:\src\sandbox\media-organizer\library_fixer-fable.py" fix --dest "Z:\clean library" --prune-empty
```
Moves each stray to the year/month its filename says, renames `2020-05-08-.jpg` →
`2020-05-08-001.jpg`, and renames `2014-02-26-` folders → `2014-02-26-event`.
`--prune-empty` removes any folders the moves left empty (optional).

**3. Undo, if you don't like the result:**
```
python "Z:\src\sandbox\media-organizer\library_fixer-fable.py" revert --dest "Z:\clean library"
```
Every change was logged to `DST\_organizer\fixes\<id>\fixlog.csv`; revert plays it back in reverse.

Notes:
- Files within `--tolerance-days` (default 31) of their event folder's date are **left in the event**
  — so a New Year's Eve party or a three-week trip isn't shredded across months.
- It only ever moves/renames **inside** the library; it never overwrites (collisions get a numeric
  suffix), never deletes a file, and never touches `untouched/`, `_needs-review/`, `_not-media/`
  or `_organizer/`.
- Not needed for libraries built with `media_organizer-fable.py` — it doesn't create this damage.

---

## The commands at a glance

| Command | What it does |
|---|---|
| `media_organizer-fable.py run --source SRC --dest DST` | **One step:** scan, copy, and verify. Simplest option. Skips files already imported. |
| `… run … --skip-library` | Same, but also skips photos already imported under a different name/path. |
| `… run … --event-span-days N --min-year Y` | Tune event grouping window (default 31 days) and oldest plausible year (default 1995). |
| `… run … --no-phone-tag --no-junk-quarantine` | Turn off the `.phone` filename token and/or the `_phone-misc` junk quarantine. |
| `media_organizer-fable.py plan --source SRC --dest DST` | Scan and build a plan only. **Copies nothing.** For reviewing first. |
| `media_organizer-fable.py execute --dest DST` | Copy everything from the latest plan, then verify. |
| `media_organizer-fable.py resume --dest DST` | Finish an interrupted copy, retry failed files (safe to run anytime). |
| `media_organizer-fable.py status --dest DST` | Quick one-line-per-run list. |
| `media_organizer-fable.py verify --source SRC --dest DST` | Content diff: missing / extra / duplicate files (add `--quick` for speed). |
| `library_fixer-fable.py scan --dest DST` | Find wrong-year strays & broken names in an existing library. **Changes nothing.** |
| `library_fixer-fable.py fix --dest DST` | Apply the repairs (add `--prune-empty` to remove emptied folders). |
| `library_fixer-fable.py revert --dest DST` | Undo the last fix run from its log. |
| `processed_summary.py --dest DST` | Readable report of all sources processed into a library. |

Every run is recorded under `DST\_organizer\`, so you can always come back and see what happened.

---

## FAQ / troubleshooting

**Will it touch my originals?** No. The source is opened read-only. Nothing is ever deleted anywhere.

**Which script should I use?** `media_organizer-fable.py` for all new runs. `library_fixer-fable.py`
once, to repair a library you built with the original `media_organizer.py`.

**Why does my `2014` folder contain photos named `2016-…`?** That's the original script's event
grouping (earliest-date-wins). Run `library_fixer-fable.py scan` — it will find and fix exactly those.

**It said `ffprobe` not found.** Videos/audio will just be dated by filename or modified-date instead.
Install ffmpeg (see setup) if you want the best dates.

**My iPhone HEIC photos all landed on the wrong date.** Install `pip install pillow-heif` and re-run —
without it HEIC files can't be read for EXIF dates and fall back to modified-time.

**How do I see only my phone photos, or only videos?** Phone-shot files carry a `.phone` token in
their name — type `.phone.` in Explorer's search box. For videos type `kind:video`. Combine both for
phone videos. Screenshots and WhatsApp saves live separately under `_phone-misc/`.

**What counts as "phone junk"?** Files whose names mark them as screenshots
(`Screenshot_*`, screen recordings) or messaging-app saves (WhatsApp `IMG-…-WA####`, `FB_IMG_*`,
`received_*`, Signal/Telegram). They're dated and kept in `_phone-misc/` — nothing is deleted. Your
actual phone *photos* (IMG_/PXL_/HEIC camera shots) stay in the main timeline, tagged `.phone`.

**A lot of files went to `_needs-review`.** Those are photos with no reliable date signal (often because
their modified-dates looked like a bulk copy). They're safe in `_needs-review/` with their original
folder structure — you can sort them by hand or re-date them and run again.

**Why are some things in `untouched/`?** They were either nested more than one folder deep, corrupt, or
duplicates — so the tool preserved them exactly rather than guess. Look there if a file seems "missing"
from the year/month tree.

**A file was locked/unreadable during the copy.** The run finishes anyway and lists the failures at the
end (also logged in `copied.log`). Close whatever holds the file and run `resume` — it retries just those.

**Can I change the rules?** Yes — the exact behavior is described in `media-organizer-prompt.md`, and
the logic lives near the top of `media_organizer-fable.py` (the extension lists and the
`assign_destinations` function). Or just ask Claude in Cowork to adjust it.
