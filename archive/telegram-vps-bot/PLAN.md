# Telegram VPS Bot

## Overview

A Dockerized service running on a VPS that exposes a webhook endpoint. A Telegram bot forwards user messages to this service, which processes them and replies. Initially responds with "hola" to every message; later will integrate Claude Code SDK for real processing.

## Architecture

```
User -> Telegram -> Telegram API -> Webhook (VPS) -> Processing -> Response -> Telegram -> User
```

### Components

1. **Web server** (FastAPI) — runs inside Docker on the VPS, receives Telegram webhook updates
2. **Telegram bot** — uses python-telegram-bot library; webhook mode in production, polling mode for local dev
3. **Processing layer** — stub that returns "hola" (future: Claude Code SDK)

## Tech Stack

- Python 3.12
- FastAPI + uvicorn
- python-telegram-bot (v20+, webhook mode)
- Docker + docker-compose

## Project Structure

```
telegram-vps-bot/
├── PLAN.md
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── app/
    ├── __init__.py
    ├── main.py          # FastAPI app, Telegram webhook route
    ├── bot.py           # Telegram bot setup and handlers
    └── processor.py     # Message processing (stub -> Claude Code SDK later)
```

## Implementation Plan

### Phase 1 — Scaffold and stub [DONE]

1. Create `requirements.txt` with dependencies
2. Create `app/main.py` — FastAPI app that:
   - Starts the Telegram bot on startup (sets webhook URL)
   - Exposes `POST /webhook` for Telegram updates
   - Exposes `GET /health` for monitoring
3. Create `app/bot.py` — Telegram bot configuration:
   - Initializes bot with token from env
   - Registers message handler that calls processor
   - If `MODE=polling`: runs the bot with `run_polling()` (no FastAPI needed)
   - If `MODE=webhook`: sets webhook to `{WEBHOOK_BASE_URL}/webhook`, integrates with FastAPI
4. Create `app/processor.py` — stub:
   - `async def process(text: str) -> str` returns `"hola"`
5. Create `Dockerfile` and `docker-compose.yml`
6. Create `.env.example` with required vars:
   - `TELEGRAM_BOT_TOKEN` — from @BotFather
   - `MODE` — `polling` for local dev, `webhook` for production (default: `polling`)
   - `WEBHOOK_BASE_URL` — public URL of VPS (only needed in webhook mode)

### Phase 2 — Claude API integration [DONE]

1. Replace stub in `processor.py` with Anthropic SDK call
2. Add `ANTHROPIC_API_KEY` to env
3. Design system prompt (Hank persona)
4. Add per-chat conversation history with 1-hour expiry

### Phase 3 — Email inbound via Mailgun webhook [DONE]

Use an email webhook service (Mailgun, SendGrid, or Cloudflare Email Routing) to receive emails and forward them to the bot as HTTP POSTs.

1. Add a lightweight HTTP server (FastAPI or built-in `run_webhook` server) with a `POST /email` endpoint
2. Parse the inbound email webhook payload (sender, subject, body)
3. Route the email body through `processor.py` to get a response from Hank
4. Reply to the sender via the email service's API (Mailgun/SendGrid send endpoint)
5. Add `EMAIL_SERVICE` config (provider choice) and API keys to `.env`
6. Set up MX records for a domain/subdomain to point to the email service
7. Configure the email service to forward inbound emails to `https://your-vps/email`

## Local Development

1. Create Telegram bot via @BotFather, get token
2. Copy `.env.example` to `.env`, set `TELEGRAM_BOT_TOKEN` and `MODE=polling`
3. `pip install -r requirements.txt`
4. `python -m app.main`
5. Message your bot on Telegram, get "hola" back

No public URL, tunnels, or Docker needed for local dev — polling mode connects outbound to Telegram's API.

## VPS Deployment

1. Point a domain/subdomain to VPS, set up HTTPS (nginx reverse proxy + Let's Encrypt)
2. Copy `.env.example` to `.env`, set `MODE=webhook` and `WEBHOOK_BASE_URL`
3. `docker-compose up -d`
4. Bot is live in webhook mode

## Notes

- **Polling mode** (local dev): bot polls Telegram for updates, no inbound connections needed
- **Webhook mode** (production): Telegram pushes updates to the server, purely reactive
- FastAPI chosen for async support and simplicity
- Single container keeps it simple; no database needed for Phase 1
