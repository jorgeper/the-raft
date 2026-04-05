# Build Log

## Phase 1 — Scaffold and stub

### Session 2026-04-04

- [step] Created `requirements.txt` — python-telegram-bot 21.10, python-dotenv
- [step] Created `app/processor.py` — stub returning "hola"
- [step] Created `app/bot.py` — message handler calling processor, `create_app()` factory
- [step] Created `app/main.py` — entrypoint with polling/webhook mode switch
- [step] Created `.env.example` with TELEGRAM_BOT_TOKEN, MODE, WEBHOOK_BASE_URL
- [step] Created `Dockerfile` and `docker-compose.yml`
- [step] Created `.gitignore`
- [note] Dropped FastAPI — not needed for Phase 1. Webhook mode uses python-telegram-bot's built-in `run_webhook()` which includes a lightweight web server. FastAPI can be added later if we need custom endpoints (Phase 3).
- [note] Phase 1 complete. Ready to test locally with `MODE=polling`.

## Phase 2 — Claude API integration

### Session 2026-04-04

- [step] Replaced stub in `processor.py` with Anthropic SDK call (AsyncAnthropic)
- [step] Added system prompt: bot is "Hank", a friendly laid-back chat buddy
- [step] Added `anthropic==0.52.0` to `requirements.txt`
- [step] Added `ANTHROPIC_API_KEY` to `.env.example`
- [note] Using `claude-sonnet-4-20250514` model.
- [step] Added per-chat conversation history — timestamped messages stored in memory, pruned to last hour
- [step] Updated `process()` to accept `chat_id` and send full history to Claude
- [step] Added console logging for message count and char counts
- [note] Explored persistent memory (memory.md with fact extraction) but reverted — too complex for now.
- [note] Phase 2 complete. Add ANTHROPIC_API_KEY to `.env` and `pip install -r requirements.txt` to test.

## Phase 3 — Email inbound via Mailgun webhook

### Session 2026-04-04

- [step] Restructured `app/main.py` — now runs FastAPI + uvicorn as the main server, telegram bot starts in lifespan
- [step] Telegram polling runs as background task inside FastAPI; webhook mode sets webhook to `/telegram`
- [step] Created `app/email_handler.py` — Mailgun inbound webhook handler on `POST /email`
- [step] Parses sender, subject, body-plain from Mailgun form data; strips reply quotes
- [step] Routes email body through `processor.py` (same as Telegram), derives chat_id from sender email hash
- [step] Sends reply via Mailgun API (`POST /v3/{domain}/messages`)
- [step] Added `GET /health` endpoint
- [step] Added fastapi, uvicorn, httpx, python-multipart to requirements.txt
- [step] Added MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM to `.env.example`
- [note] Email conversations get their own history (keyed by hashed email address), same 1-hour expiry as Telegram.
- [note] Phase 3 complete. To test email: configure Mailgun inbound routes to POST to `https://your-vps/email`.
