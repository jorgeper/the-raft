# Canonical `raw/` note format

Single source of truth for what the Second Brain capture skill writes. Both the Claude Code
skill (`skills/capture/SKILL.md`) and the Copilot CLI agent (`agents/second-brain.agent.md`)
follow this. It only ever describes **new** notes in `raw/` — existing notes, `manual/`, and
`ai/` are never touched.

## Location & naming

- File: `<vault>/raw/<YYYY-MM>/<YYYY-MM-DD>-<slug>.md`
- Attachments: `<vault>/raw/<YYYY-MM>/attachments/<YYYY-MM-DD>-<slug>.<ext>`
- `<slug>`: lowercase, hyphen-separated, derived from the title/topic, short (drop filler
  words). If the target file already exists, append `-2`, `-3`, … Create the month folder
  (and `attachments/`) if missing.
- Date defaults to today; use a user-supplied date if given.

## Front matter (lean + tldr)

```yaml
---
date: 2026-07-04           # capture date, matches the filename
source: youtube            # youtube | article | url | image | text | note
url: https://youtu.be/…    # include when there is a link; omit otherwise
tldr: One–two sentence summary of what this is   # hydrated notes only; omit for blank notes
tags: [ai, workflow]       # 2–6 short topic tags
status: to-watch           # to-watch | to-read | to-buy | reference | done | captured
kind: video                # video | article | product | image | idea | note
---
```

Field notes:
- `source` describes where it came from; `kind` describes what it is.
- Include `image_path:` (relative to the note) for image notes.
- Keep `tags` lowercase and hyphenated.

## Body

### Blank note (topic only)
```markdown
# <Title from the topic>

```
(Front matter + title + empty body. `tldr` and `url` omitted.)

### Hydrated note (from a source)
```markdown
# <Title>

<one-line meta: author/channel · duration or site · date — whatever is known>

## Summary
<a short paragraph — more detail than the tldr, describing what this is and why it matters>

## Key points
- <only when the source has clear structure worth listing>
```

### Image note
```markdown
# <Title>

![[<YYYY-MM-DD>-<slug>.<ext>]]

## AI Description
<what is visible in the image>

## Notes
<any context the user gave>
```
Also set `source: image`, `kind: image`, and `image_path: attachments/<file>` in front matter.
Copy the source image into the month's `attachments/` folder first.

### Pasted-text note
```markdown
# <Title>

> [!quote] Original
> <the original text, verbatim>

## Summary
<what the user is asking for / what this is about>
```
Set `source: text`, `kind: idea` (or `note`).

## Example (hydrated, video)

```markdown
---
date: 2026-07-04
source: youtube
url: https://www.youtube.com/watch?v=XXXX
tldr: A walkthrough of building an eval harness before scaling an agent, with a concrete PIV loop.
tags: [ai, agents, evals, workflow]
status: to-watch
kind: video
---

# Building Eval Harnesses Before You Scale an Agent

By Example Channel · 18:22 · published 2026-07-01

## Summary
Argues that the bottleneck in agent work is verifiability, not model quality. Lays out a
Plan → Implement → Verify loop and shows how a small eval harness catches regressions that
manual spot-checks miss. Practical for anyone running autonomous coding agents.

## Key points
- Verifiability is the real constraint; build the harness first.
- Keep the inner loop tight: Edit → Test → Fix.
- Spot-checks miss the jagged edges; evals surface them.
```
