# Hank — Telegram Bot

## Overview

A Telegram bot running on a Hostinger VPS behind a shared Caddy reverse proxy. Receives messages via webhook (production) or polling (local dev), processes them through a pluggable processor (Claude API by default), and replies. The bot persona is "Hank" — a friendly chat buddy.

## Architecture

```
User → Telegram → Telegram API → Caddy (HTTPS) → hank:8000 → Processor → Response → Telegram → User
```

### Components

1. **Caddy** — shared reverse proxy handling HTTPS for `hank.jorgepereira.io` (lives in parent `docker-compose.yml`)
2. **FastAPI server** — receives Telegram webhook updates on `POST /telegram`, health check on `GET /health`
3. **Telegram bot** — python-telegram-bot; webhook mode in production, polling mode for local dev
4. **Processor layer** — abstract `Processor` base class with dependency injection. `ClaudeProcessor` (default) or `HelloWorldProcessor` for testing
5. **Email handler** — Mailgun inbound webhook on `POST /email`, routes through the same processor

### Security

Two layers of protection:
1. **Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`) — verifies requests come from Telegram
2. **User allowlist** (`ALLOWED_USER_IDS`) — restricts which Telegram accounts can use the bot

## Tech Stack

- Python 3.12
- FastAPI + uvicorn
- python-telegram-bot (v20+)
- Anthropic SDK (Claude API)
- Docker (part of parent docker-compose)

## Project Structure

```
hank/
├── PLAN.md
├── LOG.md
├── CLAUDE.md
├── README.md
├── Dockerfile
├── requirements.txt
├── .env.example           # Full variable reference
├── .env.local.example     # Local dev template
├── .env.cloud.example     # Cloud deploy template
└── app/
    ├── __init__.py
    ├── main.py            # FastAPI app, processor selection, Telegram lifecycle
    ├── bot.py             # Telegram bot setup, user allowlist, DI
    ├── processor.py       # Abstract Processor base class
    ├── email_handler.py   # Mailgun inbound webhook
    └── processors/
        ├── __init__.py
        ├── claude.py      # Claude API processor (Hank personality)
        └── helloworld.py  # Echo processor for testing
```

## Implementation Plan

### Phase 1 — Scaffold and stub [DONE]

1. Create `requirements.txt` with dependencies
2. Create `app/main.py` — FastAPI app with Telegram webhook route and health endpoint
3. Create `app/bot.py` — Telegram bot with polling/webhook mode support
4. Create `app/processor.py` — stub returning "hola"
5. Create `Dockerfile` and `docker-compose.yml`
6. Create `.env.example` with required vars

### Phase 2 — Claude API integration [DONE]

1. Replace stub with Anthropic SDK call
2. Add `ANTHROPIC_API_KEY` to env
3. Design system prompt (Hank persona)
4. Add per-chat conversation history with 1-hour expiry

### Phase 3 — Email inbound via Mailgun webhook [DONE]

1. Add `POST /email` endpoint for Mailgun inbound webhooks
2. Parse sender, subject, body; strip reply quotes
3. Route through processor, reply via Mailgun API
4. Add Mailgun config to env

### Phase 4 — Processor abstraction and DI [DONE]

1. Extract `Processor` ABC from `processor.py`
2. Move Claude logic to `app/processors/claude.py` (`ClaudeProcessor`)
3. Create `app/processors/helloworld.py` (`HelloWorldProcessor`) for testing
4. Inject processor into bot and email handler via `PROCESSOR` env var
5. Split `.env` into `.env.local` / `.env.cloud` with separate templates

### Phase 5 — Infrastructure restructure [DONE]

1. Move `telegram-vps-bot/` into `jorgepereira.io/hank/`
2. Move site files into `jorgepereira.io/site/`
3. Create shared Caddy reverse proxy routing `jorgepereira.io` and `hank.jorgepereira.io`
4. Create parent `docker-compose.yml` with three services (caddy, site, hank)
5. Switch site from Caddy to nginx (Caddy is now shared)
6. Remove ghcr.io GitHub Actions workflow — build on VPS via git clone

### Phase 6 — Security: user allowlist [DONE]

1. Add `ALLOWED_USER_IDS` env var (comma-separated Telegram user IDs)
2. Filter messages in bot handler — block unauthorized users
3. Log warnings for blocked messages

### Phase 7 — Memory: save and recall [NOT STARTED]

Hank remembers things you send him — text notes, URLs, photos, whatever. Send it, forget about it, ask for it later.

**What it looks like:**
- "Hey Hank, remember this: the wifi password at the cabin is `trout42`" → Hank saves it
- Send a YouTube link → Hank saves it with the URL and any message you included
- Send a photo → Hank saves the image file (no analysis yet — that's a future phase)
- "What was the wifi password?" → Hank searches saved memories and returns it
- "What links did I save this week?" → Hank lists them

**Scope for this phase (keep it simple):**

1. Create a `Memory` storage layer — saves items with timestamp, type, and content
   - Types: `note` (text), `url` (link), `photo` (file reference)
   - Storage: SQLite file (simple, no external DB needed, persists across restarts)
   - Mount a Docker volume so data survives container rebuilds
2. Detect intent — is the user saving something or asking for something?
   - Use Claude to classify: "save" vs "recall" vs "chat" (normal conversation)
   - If save: extract what to remember and store it
   - If recall: search memories and return matches
   - If chat: handle as normal (existing flow)
3. Handle different message types:
   - Text with a URL → extract and save as `url` type with any surrounding text as context
   - Text without URL → save as `note` type
   - Photo → download the file from Telegram, save to disk, store file path as `photo` type
4. Recall via search — when the user asks for something, search memories:
   - Use Claude to generate a search query from the user's question
   - Search memory content with simple text matching (full-text search in SQLite)
   - Return matching memories with timestamps
5. Add `/memories` command — list recent saved memories
6. Add `/forget <id>` command — delete a specific memory

**Future phases (not now):**
- Image analysis: run photos through Claude vision to extract description/metadata for better search
- Tags/categories: auto-tag memories for structured recall
- Embeddings: vector search for semantic recall instead of text matching
- Periodic summaries: "here's what you saved this week"

## Notes

- **Polling mode** (local dev): bot polls Telegram for updates, no inbound connections needed
- **Webhook mode** (production): Telegram pushes updates to the server via Caddy
- Processor is pluggable — set `PROCESSOR=helloworld` to test without API keys
- Deployed at `hank.jorgepereira.io` on Hostinger VPS
