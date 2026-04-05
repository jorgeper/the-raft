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

Message processing is abstracted behind the `Processor` base class (`app/processor.py`). Both Telegram and email use the same processor instance, injected at startup.

### HankProcessor (default)

The main processor (`app/processors/hank.py`) is a smart orchestrator:

1. Receives a message with an optional pre-determined `intent`
2. If no intent: asks Claude to classify as "chat" or "remember"
3. Routes to the appropriate action module:
   - **chat** → `app/actions/chat.py` — Claude API conversation with Hank personality
   - **remember** → `app/actions/remember.py` — saves content as markdown files to disk

```
Message → HankProcessor → detect intent (Claude) → action module → reply
                          ↑
          remember@ shortcut: intent="remember" (skips detection)
```

### Available processors

| Name         | Class                  | File                            | Requires           |
|--------------|------------------------|---------------------------------|---------------------|
| `hank`       | `HankProcessor`        | `app/processors/hank.py`       | `ANTHROPIC_API_KEY` |
| `helloworld` | `HelloWorldProcessor`  | `app/processors/helloworld.py`  | Nothing             |

### Action modules

| Action     | File                      | What it does                              |
|------------|---------------------------|-------------------------------------------|
| `chat`     | `app/actions/chat.py`     | Claude API conversation with history       |
| `remember` | `app/actions/remember.py` | Saves markdown files to `data/memories/`   |

### Adding a new intent

1. Create an action module in `app/actions/`
2. Add the intent to the detection prompt in `app/processors/hank.py`
3. Add routing logic in `HankProcessor.process()`

## Security

### Telegram

1. **Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`) — verifies HTTP requests to `/telegram` come from Telegram. Checked in `app/main.py`.
2. **User allowlist** (`ALLOWED_USER_IDS`) — restricts which Telegram accounts can use the bot. Checked in `app/bot.py`. Empty = anyone.

### Email

1. **Mailgun signature** (`MAILGUN_API_KEY`) — every inbound webhook includes a signature (token + timestamp + signature). The handler verifies it using HMAC-SHA256, rejecting forged requests. Checked in `app/email_handler.py`.
2. **Sender allowlist** (`ALLOWED_EMAIL_SENDERS`) — restricts which email addresses can email Hank. Checked in `app/email_handler.py`. Empty = anyone.

## Infrastructure

Hank runs as one service in a three-service docker-compose setup (see `../docker-compose.yml`):

- **caddy** — shared reverse proxy, ports 80/443, auto HTTPS via Let's Encrypt
- **site** — `jorgepereira.io` static website (nginx)
- **hank** — `hank.jorgepereira.io` (FastAPI + uvicorn on port 8000)

Caddy routes by domain name. Services communicate over a Docker network by service name.

## Slash Commands

Messages starting with `/` bypass the processor entirely and go through a separate
command router (`app/commands/`). No LLM involved — instant response, zero cost.

- **Telegram:** python-telegram-bot routes `/commands` to the command handler
- **Email:** if the first line of the body starts with `/`, it's treated as a command

Commands are registered in `app/commands/__init__.py`. Each command is an async handler
function that receives `(args, chat_id)` and returns a reply string.

## Key Files

- `app/main.py` — entrypoint, processor selection, FastAPI server, Telegram lifecycle
- `app/bot.py` — Telegram bot setup, command handlers, user allowlist
- `app/email_handler.py` — Mailgun inbound webhook, recipient/command routing, reply sending
- `app/processor.py` — abstract Processor base class
- `app/processors/hank.py` — HankProcessor: intent detection + routing to actions
- `app/processors/helloworld.py` — echo processor for testing
- `app/commands/__init__.py` — command registry and router
- `app/commands/echo.py` — /echo command
- `app/commands/help.py` — /help command (auto-generated from registry)
- `app/actions/chat.py` — Claude API conversation with Hank personality
- `app/actions/remember.py` — saves markdown files to `data/memories/`
- `LOG.md` — session-by-session progress log
- `plans/` — feature PRDs and designs
