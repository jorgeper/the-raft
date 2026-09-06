# claude-usage-tui

A terminal dashboard for Claude Code usage, in five collapsible sections on one screen. Stays open until you press **Esc** (or `q`); `r` forces a refresh; **1–5** toggle sections. Every section's title shows when it last updated; stats auto-refresh every 30s, meters every 60s.

- **Rate limits** — the real `/usage` meters (session 5h, weekly, Opus/Fable weekly) fetched from Anthropic's read-only usage endpoint using the OAuth token Claude Code stores in the macOS Keychain, plus burn rate and a projected-exhaustion warning when your pace would beat the reset.
- **Usage** — prompts, tokens, and API-equivalent value for today / 7 days / 30 days, plus a per-model breakdown, parsed incrementally from `~/.claude/projects/**/*.jsonl`.
- **Sessions** — each session from the last 24h: context fill %, duration, prompts, subagents, branch, last tool, value.
- **History** (collapsed by default) — 30-day daily chart, hour-of-week heatmap, top projects.
- **Analytics** (collapsed by default) — tool leaderboard, cache hit rate, subagent share.

## Run

```bash
uv run --directory ~/src/claude-usage-tui claude-usage
```

Handy alias:

```bash
alias claude-usage='uv run --directory ~/src/claude-usage-tui claude-usage'
```

## Develop

```bash
uv run pytest
```

Costs are estimates at API list prices (subscriptions don't bill per token); the pricing table lives in `src/claude_usage/pricing.py` — update it when prices change.
