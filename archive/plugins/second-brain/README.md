# Second Brain

A small plugin for capturing notes into an [Obsidian](https://obsidian.md) vault's `raw/`
folder. One adaptive skill, **capture**, that either:

- creates a **blank** note from a topic ("create a note about X"), or
- **hydrates** a note from a source you give it — a URL, YouTube link, webpage, image, doc,
  or pasted text — by summarizing it, writing a `tldr`, and preserving the original.

It writes to `raw/<YYYY-MM>/<YYYY-MM-DD>-<slug>.md` using a consistent front matter format.
It is **append-only**: it never edits existing notes and never touches your `manual/` or
`ai/` folders.

It installs in **two** tools — pick the one you use. The instructions are independent; you
don't need to read both.

---

## Install for Claude Code

The `plugins/` directory in this repo is a Claude Code marketplace named `sandbox-plugins`.

```bash
# 1. Register the local marketplace (point at the plugins/ directory)
claude plugin marketplace add ~/src/sandbox/plugins

# 2. Install the plugin
claude plugin install second-brain@sandbox-plugins

# 3. Verify
claude plugin marketplace list
```

Then, in any Claude Code session, just ask naturally — the `capture` skill loads by
description:

```
create a note about the espresso puck-collapse thing
capture this: https://www.youtube.com/watch?v=…
save this image ~/Downloads/diagram.png as a note
```

To update after you change the plugin files: `claude plugin marketplace update sandbox-plugins`.

---

## Install for GitHub Copilot CLI

Copilot CLI doesn't support custom slash commands yet, so this ships as a **custom agent**.
Install it by copying (or symlinking) the agent file into your user agents directory:

```bash
# Copy the agent into your personal Copilot agents directory
mkdir -p ~/.copilot/agents
cp ~/src/sandbox/plugins/second-brain/agents/second-brain.agent.md ~/.copilot/agents/

# (Optional) symlink instead, so it updates when you pull this repo:
# ln -sf ~/src/sandbox/plugins/second-brain/agents/second-brain.agent.md ~/.copilot/agents/second-brain.agent.md
```

Then use it from the Copilot CLI:

```bash
# Interactive: pick the agent
copilot
# …then run: /agent   and choose "Second Brain"

# Or invoke it directly:
copilot --agent second-brain -p "capture this: https://www.youtube.com/watch?v=…"
```

To verify it's registered, run `/agent` in an interactive session and confirm **Second Brain**
appears in the list.

---

## Where does it write? (vault resolution)

The skill figures out which vault to use, in this order (first match wins):

1. A vault path/name you mention in the request.
2. **Auto-detect** — it walks up from your current directory for a folder containing both
   `.obsidian/` and `raw/`. So if you run the tool inside your vault, there's nothing to
   configure.
3. A saved path in `~/.config/second-brain/config.json` (`{ "vault_path": "..." }`).
4. If none of the above, it asks you once and offers to save your answer to that config file.

To change it later: run inside a different vault (auto-detect wins), say "set my second brain
vault to `<path>`", or edit/delete `~/.config/second-brain/config.json`.

---

## What it writes

Front matter (canonical format — full spec in [`reference/raw-note-format.md`](reference/raw-note-format.md)):

```yaml
---
date: 2026-07-04
source: youtube            # youtube | article | url | image | text | note
url: https://youtu.be/…    # link sources only
tldr: One–two sentence summary   # hydrated notes only
tags: [ai, workflow]
status: to-watch           # to-watch | to-read | to-buy | reference | done | captured
kind: video                # video | article | product | image | idea | note
---
```

Body: an `# H1` title, a one-line source/meta line, a `## Summary`, and (when the source has
structure) `## Key points`. Images are copied into `raw/<YYYY-MM>/attachments/` and embedded
with an `## AI Description`; pasted text is preserved in a `> [!quote] Original` callout.

## What it does NOT do

- Doesn't touch `manual/` or `ai/`.
- Doesn't edit, move, reorganize, or delete existing notes.
- Doesn't commit anything to git — that's up to you.

## Layout

```
second-brain/
├── README.md                       # this file
├── DESIGN.md                       # design spec
├── .claude-plugin/plugin.json      # Claude Code plugin manifest
├── skills/capture/SKILL.md         # Claude Code skill
├── agents/second-brain.agent.md    # Copilot CLI custom agent
└── reference/raw-note-format.md    # canonical note format (single source of truth)
```
(The Claude Code marketplace manifest is one level up, at `plugins/.claude-plugin/marketplace.json`.)
