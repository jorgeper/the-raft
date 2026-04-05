# Architecture

## Overview

Hank is a chat bot with two interfaces — Telegram and email. Both route messages through the same pluggable processor and reply through their respective channels. Runs on a Hostinger VPS behind a shared Caddy reverse proxy.

```
Telegram user → Telegram API → Caddy (HTTPS) → POST /telegram → Processor → Telegram API → reply
Email sender  → Mailgun       → Caddy (HTTPS) → POST /email    → Processor → Mailgun API  → reply
```

## Message Channels

### Telegram (`app/bot.py`)

- **Production (webhook):** Telegram pushes updates to `https://hank.jorgepereira.io/telegram`
- **Local dev (polling):** Bot polls Telegram API for updates, no public URL needed
- Conversation history per chat_id, 1-hour rolling window
- User allowlist via `ALLOWED_USER_IDS`

### Email (`app/email_handler.py`)

- Mailgun receives email at `hank@hank.jorgepereira.io` (MX records point to Mailgun)
- Mailgun forwards to `https://hank.jorgepereira.io/email` as a POST with form data
- Bot verifies the Mailgun signature, strips reply quotes
- Routes to different processors based on recipient address:
  - `hank@` → chat processor (Claude) — conversation with Hank
  - `remember@` → remember processor — saves email content as markdown files to disk
- Replies via Mailgun send API — lands in sender's inbox
- Chat conversations: per-sender history (keyed by hashed email address), 1-hour expiry
- Remember: saves to `data/memories/YYYY-MM-DD/` as markdown files (Docker volume)

### Shared behavior

Both channels:
1. Receive a message (text)
2. Pass it to `processor.process(chat_id, text)`
3. Get a reply string back
4. Send it through their respective API

The processor doesn't know or care which channel the message came from.

## Processor Architecture

Message processing is abstracted behind the `Processor` base class (`app/processor.py`). The bot doesn't know which processor it's using — it receives one via dependency injection at startup.

### How it works

1. `app/main.py` reads the `PROCESSOR` env var (default: `claude`)
2. It instantiates the matching `Processor` subclass
3. It passes the instance to `app/bot.py` and `app/email_handler.py`
4. Both channels call `processor.process(chat_id, text)` for every incoming message

### Available processors

| Name         | Class                  | File                            | Requires           |
|--------------|------------------------|---------------------------------|---------------------|
| `claude`     | `ClaudeProcessor`      | `app/processors/claude.py`      | `ANTHROPIC_API_KEY` |
| `helloworld` | `HelloWorldProcessor`  | `app/processors/helloworld.py`  | Nothing             |
| `remember`   | `RememberProcessor`    | `app/processors/remember.py`    | Nothing             |

### Adding a new processor

1. Create a file in `app/processors/`
2. Subclass `Processor` and implement `async def process(self, chat_id: int, text: str) -> str`
3. Register it in `_load_processors()` in `app/main.py`

## Security

### Telegram

1. **Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`) — verifies HTTP requests to `/telegram` come from Telegram. Checked in `app/main.py`.
2. **User allowlist** (`ALLOWED_USER_IDS`) — restricts which Telegram accounts can use the bot. Checked in `app/bot.py`. Empty = anyone.

### Email

1. **Mailgun signature** (`MAILGUN_API_KEY`) — every inbound webhook includes a signature (token + timestamp + signature). The handler verifies it using HMAC-SHA256, rejecting forged requests. Checked in `app/email_handler.py`.
2. **Sender allowlist** — not yet implemented. Anyone who knows the email address can email Hank.

## Infrastructure

Hank runs as one service in a three-service docker-compose setup (see `../docker-compose.yml`):

- **caddy** — shared reverse proxy, ports 80/443, auto HTTPS via Let's Encrypt
- **site** — `jorgepereira.io` static website (nginx)
- **hank** — `hank.jorgepereira.io` (FastAPI + uvicorn on port 8000)

Caddy routes by domain name. Services communicate over a Docker network by service name.

## Key Files

- `app/main.py` — entrypoint, processor selection, FastAPI server, Telegram lifecycle
- `app/bot.py` — Telegram bot setup, user allowlist, receives Processor via DI
- `app/email_handler.py` — Mailgun inbound webhook, signature verification, reply sending
- `app/processor.py` — abstract Processor base class
- `app/processors/claude.py` — Claude API processor (Hank personality, conversation history)
- `app/processors/helloworld.py` — echo processor for testing
- `LOG.md` — session-by-session progress log
- `plans/` — feature PRDs and designs (e.g. `plans/MEMORY.md`)
