# claude-usage-tui

A terminal dashboard for Claude Code usage. Stays open until you press **Esc** (or `q`); `r` forces a refresh.

- **Rate limits** — the real `/usage` meters (session 5h, weekly, Opus/Fable weekly), fetched every 60s from Anthropic's read-only usage endpoint using the OAuth token Claude Code stores in the macOS Keychain. Degrades to an error note if unavailable.
- **Usage stats** — prompts, tokens, and API-equivalent cost for today / 7 days / 30 days, plus a per-model breakdown, parsed incrementally from `~/.claude/projects/**/*.jsonl` (refreshes every 30s).
- **Local sessions** — recently-active sessions (project, last activity) and the number of running `claude` processes (every 10s).

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
