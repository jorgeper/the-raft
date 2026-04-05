# Claude Code Instructions

## Project

Hank — a Telegram bot deployed at `hank.jorgepereira.io`. See `ARCHITECTURE.md` for full technical details. Key points:
- Processor DI: `PROCESSOR` env var → `Processor` subclass → injected into bot and email handler
- Two security layers: webhook secret + `ALLOWED_USER_IDS`
- Runs behind shared Caddy reverse proxy (see `../docker-compose.yml`)

## Starting a session

1. Read `ARCHITECTURE.md` to understand the app
2. Read `LOG.md` to see what was done previously
3. Ask the user what to work on

## Feature workflow

Features go through three stages:

### 1. PRD (`plans/<FEATURE>.md`)

Define what to build. Write the PRD, iterate with the user until it looks good. Contains:
- User stories / examples
- Scope (what's in, what's out)
- Future considerations

### 2. Design (`plans/<FEATURE>.design.md`)

Define how to build it. Write the design, iterate with the user until it looks good. Contains:
- Technical approach
- Data model / storage
- API changes
- Key implementation decisions

### 3. Build

Implement the feature following the design. During implementation:
- Log progress in `LOG.md` as you go
- Update `ARCHITECTURE.md` if the architecture changed
- Do NOT start the next feature unless the user asks

## LOG.md format

```
## <feature name>

### Session <date>

- [step] <what was done>
- [step] <what was done>
- [note] <any decisions, blockers, or context for next session>
```

## Code conventions

- Python 3.12, async where possible
- Use `python-telegram-bot` v20+ (async API)
- FastAPI for the web server
- All config from environment variables (never hardcode secrets)
- Keep it simple — no premature abstractions
