# Claude Code Instructions

## Project

Telegram VPS Bot — a Dockerized service that receives Telegram messages via webhook (production) or polling (local dev), processes them, and replies. See `PLAN.md` for full architecture and phase breakdown.

## How to Work on This Project

### Starting a session

1. Read `PLAN.md` to understand the current phase statuses
2. Read `LOG.md` to see what was done in previous sessions
3. Ask the user which phase to work on, or continue the current in-progress phase

### During a phase

- Work through the phase steps listed in `PLAN.md` one at a time
- After completing each step, append an entry to `LOG.md` with what was done
- If a step is blocked or needs user input, note it in `LOG.md` and ask the user

### Completing a phase

1. Update the phase status in `PLAN.md` from `[IN PROGRESS]` to `[DONE]`
2. Add a phase completion summary to `LOG.md`
3. Do NOT start the next phase unless the user asks

### Ad-hoc / unplanned work

Sometimes the user will request changes outside the current plan. When this happens:
1. Do the work
2. Retroactively update `PLAN.md` — add the work to the most relevant phase, or add a new phase if it doesn't fit
3. Log it in `LOG.md` under the relevant phase section
4. The plan is a living document — it should always reflect what was actually built, not just what was originally scoped

### Phase status markers in PLAN.md

- `[NOT STARTED]` — not yet begun
- `[IN PROGRESS]` — currently being worked on
- `[DONE]` — completed

## LOG.md Format

Each entry in `LOG.md` follows this format:

```
## Phase N — <name>

### Session <date>

- [step] <what was done>
- [step] <what was done>
- [note] <any decisions, blockers, or context for next session>
```

## Code Conventions

- Python 3.12, async where possible
- Use `python-telegram-bot` v20+ (async API)
- FastAPI for the web server
- All config from environment variables (never hardcode secrets)
- Keep it simple — no premature abstractions

## Key Files

- `PLAN.md` — phases, architecture, status tracking
- `LOG.md` — session-by-session progress log
- `app/main.py` — entrypoint
- `app/bot.py` — Telegram bot setup
- `app/processor.py` — message processing logic
