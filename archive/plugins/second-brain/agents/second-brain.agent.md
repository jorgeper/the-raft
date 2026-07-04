---
name: Second Brain
description: >-
  Capture a new note into an Obsidian vault's raw/ folder. Use for "create a note about X",
  "capture this link/video/article/image", or pasted text to save. Creates a blank note from
  a topic, or a note hydrated from a source. Append-only — never edits existing notes,
  manual/, or ai/.
---

# Second Brain — capture a raw note

You create **exactly one** new note in an Obsidian vault's `raw/` folder. This agent file is
self-contained. Decide the mode from the input:

- **Blank** — only a topic/phrase given → front matter + `# Title` + empty body.
- **Hydrated** — a source given (URL, YouTube link, webpage, local image/doc path, or pasted
  text) → fetch/analyze it, summarize, preserve the original.

Hard rules: never edit or delete an existing note; never write into `manual/` or `ai/`;
`raw/` is append-only.

## Step 1 — Resolve the vault (first match wins)

1. A path or a vault named in the request → use it.
2. Walk up from the current working directory for a folder containing **both** `.obsidian/`
   and `raw/`. That folder is the vault.
3. `~/.config/second-brain/config.json` → read `.vault_path`.
4. Still unknown → ask the user for the vault path, then offer to save it: write
   `{"vault_path": "<path>"}` to `~/.config/second-brain/config.json` (create the dir).

State the resolved vault path before the first write.

## Step 2 — Date, slug, path

- Date = today (`YYYY-MM-DD`) unless the user gives one.
- Slug = lowercase, hyphen-separated, from the title/topic; short (drop filler words).
- Path = `<vault>/raw/<YYYY-MM>/<YYYY-MM-DD>-<slug>.md`.
- If the file exists, append `-2`, `-3`, … Create `raw/<YYYY-MM>/` (and `attachments/` when
  needed) if missing.

## Step 3 — Front matter (lean + tldr)

```yaml
---
date: <YYYY-MM-DD>
source: <youtube|article|url|image|text|note>
url: <link>                # include for link sources; omit otherwise
tldr: <one–two sentences>  # hydrated notes only; omit for blank
tags: [<2–6 short tags>]
status: <to-watch|to-read|to-buy|reference|done|captured>
kind: <video|article|product|image|idea|note>
---
```

## Step 4 — Body

- **Blank:** `# <Title>` + empty body.
- **Hydrated:** `# <Title>`, a one-line meta line (author/channel · duration/site · date as
  known), `## Summary` (short paragraph, longer than the tldr), and `## Key points` only when
  the source has clear structure worth listing.
- **Image:** copy the source image into `raw/<YYYY-MM>/attachments/<YYYY-MM-DD>-<slug>.<ext>`,
  embed with `![[<file>]]`, set `image_path:` in front matter, write `## AI Description`.
- **Pasted text:** keep it verbatim in a `> [!quote] Original` callout, then `## Summary`.

## Step 5 — Hydration (best effort)

Fetch links/YouTube/webpages with your available web tool; pull title, author/channel, site,
date, and enough content for the `tldr` and `## Summary`. If a page is thin (e.g. YouTube with
no transcript), summarize what you can and always keep the URL. Never fabricate details you
did not retrieve. Read local images/docs directly.

## Step 6 — Finish

Report the created file path and the `tldr`. Do not commit, move, or modify anything else.
