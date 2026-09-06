# claude-usage-tui

A gruvbox-themed terminal dashboard for **Claude Code** usage on macOS. One screen, four collapsible sections, auto-refreshing. It answers three questions at a glance: *how close am I to my rate limits, what have I been using, and what's running right now?*

```
▼ Rate limits · live · updated 21:27:41
  Session (5h)        ██████████████████████░░░░░░░░░░░░░░░░░░  55%   resets in 1h 42m
  Week (all models)   ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  29%   resets in 1d 7h
  Week (Opus/Fable)   ███████████████████░░░░░░░░░░░░░░░░░░░░░  47%   resets in 1d 7h
  Burn (last hour)    38.5K out-tok/min · $12/h API value · 96 calls

▼ Usage (all projects) · $46 today · updated 21:27:41
                 prompts    input   output   cache rd   API value*
  Today               17     1.3M     0.4M      30.4M       $45.70
  ...
```

## Sections

| Key | Section | Shows |
|-----|---------|-------|
| `1` | **Rate limits** | The real `/usage` meters — session (5h), weekly, Opus/Fable weekly — with reset countdowns, burn rate over the last hour, and a ⚠ projection when your current pace would hit 100% *before* the reset. |
| `2` | **Usage** | Prompts, input/output/cache-read tokens, and API-equivalent value for today / 7 days / 30 days, plus a per-model breakdown. |
| `3` | **Sessions** | Every session from the last 24h: live indicator, project + git branch, model, context fill (tokens and % of the model's window), duration, prompt count, subagent calls, last tool used, value. |
| `4` | **History & Analytics** | Side by side: a 30-day daily value chart, hour-of-week activity heatmap, and top projects — next to a tool-call leaderboard, cache hit rate, and subagent share. Collapsed by default. |

Other keys: **Esc**/`q` quit · `r` force refresh. Data auto-refreshes on its own — local stats every 30s, rate-limit meters every 60s — and each section title shows its last update time.

## Install

Requires Python ≥3.12 and [uv](https://docs.astral.sh/uv/) (`brew install uv`).

```bash
git clone https://github.com/jorgeper/claude-usage-tui
uv tool install --editable ./claude-usage-tui
```

That puts a `claude-usage` executable on your PATH (`~/.local/bin`). Then:

```bash
claude-usage           # full-screen dashboard
claude-usage --once    # print a snapshot to stdout and exit (script/cron friendly)
claude-usage --help
```

## How it works, and what it touches

- **Rate-limit meters** come from Anthropic's read-only OAuth usage endpoint — the same call Claude Code makes to draw its `/usage` screen — authenticated with the OAuth token Claude Code already stores in the macOS Keychain (`Claude Code-credentials`). The call spends no tokens and bills nothing. If it fails (offline, no keychain entry), the panel degrades with a note; everything else keeps working.
- **Everything else is local.** Stats are parsed from the Claude Code transcripts in `~/.claude/projects/**/*.jsonl`. Parsing is incremental — the scanner remembers per-file byte offsets and reads only appended data, so refreshes stay instant even with hundreds of MB of transcripts. Records are deduped by message + request id (continued sessions copy old lines into new files).
- **Nothing leaves your machine** except that one usage GET to `api.anthropic.com`.

## Notes

- **"API value" is not a bill.** Subscriptions are flat-fee; the dollar figures are what your token traffic *would* cost at API list prices — a value-extracted metric, deliberately labeled to avoid heart attacks.
- The pricing table (`src/claude_usage/pricing.py`) and the usage-endpoint response shape (`src/claude_usage/limits.py`) are the two things most likely to drift as Anthropic ships changes — both are small and isolated.
- The exhaustion projection samples meter percentages while the app is open, so it needs a few minutes of runtime before it can extrapolate, and it can't see usage from before launch.

## Develop

```bash
uv run pytest        # unit tests for parsing, pricing, aggregation, analytics
uv run claude-usage  # run from the checkout
```

The layered design: `transcripts.py` (parse) → `scanner.py` (incremental read + dedup) → `aggregate.py` / `session_stats.py` / `history.py` / `burn.py` / `analytics.py` (pure analysis, all unit-tested) → `app.py` (Textual UI) / `snapshot.py` (`--once` output).
