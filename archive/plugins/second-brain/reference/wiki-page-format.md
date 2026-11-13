# Canonical wiki page + state format

Single source of truth for what the `wiki` skill produces. The Claude skill
(`skills/wiki/SKILL.md`) and the Copilot agent (`agents/second-brain-wiki.agent.md`) both
follow this. The wiki skill writes **only** under `<vault>/wiki/` (the pages and the state
file). It reads `raw/` but never modifies it, and never touches `manual/` or `ai/`.

## Output location

- One page per selected tag: `<vault>/wiki/<tag>.md` (filename is just the tag — `trips.md`,
  `llm.md`). No date in the filename.
- Incremental state: `<vault>/wiki/.second-brain-index.json` (hidden dotfile; Obsidian
  ignores it).

## Wiki page layout

```markdown
---
area: <tag>
last_update: <ISO timestamp>
note_count: <N>
tags: [wiki]
---

# <tag> — wiki

## <Note Title>
<Readable date, e.g. "May 17, 2026"> · #tag1 #tag2 · [[<note-basename>|open full note]]

<compressed summary — a few paragraphs; include the single most important table or an
embedded image ![[file.png]] when one is clearly central>

---

## <Next Note Title>
…
```

Rules:
- Notes are stacked **newest date first**.
- The backlink sits directly under the note's title (top of each block). `<note-basename>` is
  the raw note's filename without `.md` (Obsidian resolves it by name).
- `---` separates note blocks.
- The date is human-readable (`May 17, 2026`), derived from the note's `date:` field.
- The tag chips are the note's own tags.

## Compressed summary — quality bar

Write it as tight prose — mostly 1–3 short paragraphs. Keep it scannable with a **few longer
bold phrases**, not many tiny bolded words.

- **Bold sparingly:** at most ~4 bold phrases in the whole summary, each a short meaningful
  phrase of **up to ~5 words** — never scattered single words. Pick the phrases that carry the
  core idea, so someone reading only the bold gets the gist.
- Prefer prose; use bullets only for a genuine short list.
- Include the single most important **table** (copied verbatim) or one embedded **image**
  (`![[attachments-filename.png]]`) if one is central — otherwise neither.
- Keep it compressed — cut filler. Never invent content. Do not repeat the title or the
  backlink inside the summary (the page adds those).

Example shape (note: only ~4 bold spans, each a short phrase):
```markdown
A two-model split for coding — **Opus plans, Sonnet builds** — distilled from ~900 hours. The
throughline is to **plan before you build**: write a plan file, pick an effort level, then
implement and finish with a **full security review** before shipping, leaning on live web data
and **up-to-date docs fetched mid-task**.
```

## State file schema

```json
{
  "version": 1,
  "generated_tags": ["llm", "data"],
  "last_run": "2026-07-04T09:00:00-07:00",
  "notes": {
    "raw/2026-05/2026-05-17-coffee-physics-physicsworld.md": {
      "hash": "<sha256 of the file contents>",
      "date": "2026-05-17",
      "title": "Coffee with a Splash of Physics",
      "tags": ["coffee", "physics", "espresso", "article"],
      "summary_md": "<the compressed summary block for this note>"
    }
  }
}
```

- `generated_tags`: every tag a page has been built for (so a no-argument run refreshes them).
- `notes`: the summary cache, keyed by vault-relative note path. A note is **stale** when its
  path is missing or its `hash` changed; only stale notes are re-summarized.
- Paths are relative to the vault root.

## Rebuild from scratch (ignore the cache)

When the user asks to re-index / rebuild everything from scratch (e.g. "re-index everything",
"rebuild the wiki from scratch", "full reindex" — useful after the summary format changes),
treat **every** relevant note as stale: ignore cached `summary_md` and regenerate all
summaries in the current format. If no tags are named on a full rebuild, rebuild every tag in
`generated_tags`. The regenerated summaries overwrite the cache, so subsequent normal runs go
back to incremental.
