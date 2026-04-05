# Architecture

## Overview

Hank is a chat bot with two interfaces — Telegram and email. Both route messages through the same processor and reply through their respective channels. Runs on a Hostinger VPS behind a shared Caddy reverse proxy.

```
Telegram user → Telegram API → Caddy (HTTPS) → POST /telegram → Processor → Telegram API → reply
Email sender  → Mailgun       → Caddy (HTTPS) → POST /email    → Processor → Mailgun API  → reply
```

## Message Flow

```
Incoming message
  │
  ├── Starts with /? → Slash command router (no LLM, instant)
  │
  └── Regular message → HankProcessor
                          │
                          ├── Intent resolver (app/intent.py)
                          │     1. Explicit override (remember@ shortcut)  → free
                          │     2. Bare URL heuristic                      → free
                          │     3. Keyword prefix ("remember this")        → free
                          │     4. LLM classification (Claude)             → costs tokens
                          │
                          ├── intent = "chat" → ChatAction (Claude API)
                          │
                          └── intent = "remember" → save_memory()
                                                      → write frontmatter + content
                                                      → run post-processors
                                                      → return confirmation
```

## Message Channels

### Telegram (`app/bot.py`)

- **Production (webhook):** Telegram pushes updates to `https://hank.jorgepereira.io/telegram`
- **Local dev (polling):** Bot polls Telegram API for updates, no public URL needed
- Conversation history per chat_id, 1-hour rolling window
- User allowlist via `ALLOWED_USER_IDS`
- Passes `MemoryMetadata(medium="telegram", source="Name (id=123)")` for remember

### Email (`app/email_handler.py`)

- Mailgun receives email at `*@hank.jorgepereira.io` (MX records point to Mailgun)
- Mailgun forwards to `https://hank.jorgepereira.io/email` as a POST with form data
- Verifies the Mailgun signature, strips reply quotes
- Routes by recipient and content:
  - First line starts with `/` → slash command router
  - `remember@` → processor with `intent="remember"` (skips detection)
  - Everything else → processor with no intent (resolver detects it)
- Replies via Mailgun send API (HTML for rich content like tables, plain text otherwise)
- Passes `MemoryMetadata(medium="email"|"email-remember", source=sender)` for remember

### Channel-aware rendering (`app/message.py`)

Commands and processors can return `Message` objects that render differently per channel:
- `TextMessage` — plain text, same everywhere
- `TableMessage` — compact list on Telegram, styled HTML table on email
- `render_response()` handles both plain strings and Message objects

## Processor Architecture

Message processing is abstracted behind the `Processor` base class (`app/processor.py`). Both Telegram and email use the same processor instance, injected at startup.

### HankProcessor (default)

The main processor (`app/processors/hank.py`) delegates intent detection to `app/intent.py` and routes to action modules.

### Available processors

| Name         | Class                  | File                            | Requires           |
|--------------|------------------------|---------------------------------|---------------------|
| `hank`       | `HankProcessor`        | `app/processors/hank.py`       | `ANTHROPIC_API_KEY` |
| `helloworld` | `HelloWorldProcessor`  | `app/processors/helloworld.py`  | Nothing             |

## Intent Resolver (`app/intent.py`)

Centralized intent detection. Runs a chain of checks from cheapest to most expensive:

1. **Explicit override** — `remember@` shortcut passes `intent="remember"` directly. Free.
2. **Bare URL** — message is just a URL. Auto-remember. Free.
3. **Keyword prefix** — starts with "remember this", "save this", etc. Free.
4. **LLM classification** — sends first 500 chars to Claude. Only when heuristics can't decide.

To add a new heuristic: add a function to `_HEURISTICS` list in `intent.py`.

## Action Modules

| Action     | File                      | What it does                              |
|------------|---------------------------|-------------------------------------------|
| `chat`     | `app/actions/chat.py`     | Claude API conversation with history       |
| `remember` | `app/actions/remember.py` | Saves markdown files with frontmatter      |

### Memory Storage

Memories are markdown files with YAML frontmatter (Obsidian-compatible):

```yaml
---
date: 2026-04-05
time: "22:06:47"
medium: telegram
type: url
source: Jorge (id=123)
tags: []
title: "Page Title"        # added by URL post-processor
---

# https://example.com

https://example.com
```

- Stored in `data/memories/YYYY-MM-DD/<timestamp>_<slug>.md`
- Docker volume (`hank_memories`) persists across container rebuilds
- Content type auto-detected: `url` (bare URL) or `note` (everything else)
- `MemoryMetadata` dataclass carries medium, source, type, tags through the chain

### Post-Processing Pipeline (`app/actions/post_processors/`)

After saving, post-processors run based on content type:

| Type   | Processor          | What it does                           |
|--------|--------------------|----------------------------------------|
| `url`  | `fetch_url_title`  | Fetches page `<title>`, adds to frontmatter |
| `note` | (none)             |                                        |

Runs synchronously for now. To add a new post-processor: create a function in `post_processors/` and register it in `POST_PROCESSORS` by content type.

## Slash Commands (`app/commands/`)

Messages starting with `/` bypass the processor entirely — no LLM, instant response, zero cost.

- **Telegram:** `CommandHandler` for registered commands, catch-all for unknown
- **Email:** first line of body starts with `/`

Commands are registered in `app/commands/__init__.py`. Each handler receives `(args, chat_id, channel)` and returns a `str` or `Message`.

| Command   | What it does                                    |
|-----------|-------------------------------------------------|
| `/echo`   | Echo back the text                              |
| `/help`   | List available commands                         |
| `/memory` | List saved memories for a date (today/yesterday/YYYY-MM-DD) |

## Security

### Telegram

1. **Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`) — verifies requests come from Telegram.
2. **User allowlist** (`ALLOWED_USER_IDS`) — restricts which Telegram accounts can use the bot.

### Email

1. **Mailgun signature** (`MAILGUN_WEBHOOK_SIGNING_KEY`) — HMAC-SHA256 verification of inbound webhooks.
2. **Sender allowlist** (`ALLOWED_EMAIL_SENDERS`) — restricts which email addresses can email Hank.

## Infrastructure

Three-service docker-compose setup (see `../docker-compose.yml`):

- **caddy** — shared reverse proxy, ports 80/443, auto HTTPS via Let's Encrypt
- **site** — `jorgepereira.io` static website (nginx)
- **hank** — `hank.jorgepereira.io` (FastAPI + uvicorn on port 8000)

Caddy routes by domain name. Services communicate over a Docker network by service name.

## Key Files

- `app/main.py` — entrypoint, processor selection, FastAPI server, Telegram lifecycle
- `app/bot.py` — Telegram bot setup, command handlers, user allowlist
- `app/email_handler.py` — Mailgun inbound webhook, recipient/command routing, reply sending
- `app/processor.py` — abstract Processor base class
- `app/processors/hank.py` — HankProcessor: intent routing to actions
- `app/processors/helloworld.py` — echo processor for testing
- `app/intent.py` — centralized intent resolver (heuristics + LLM fallback)
- `app/message.py` — channel-aware Message types (TextMessage, TableMessage)
- `app/commands/__init__.py` — command registry and router
- `app/commands/echo.py` — /echo command
- `app/commands/help.py` — /help command
- `app/commands/memory.py` — /memory command
- `app/actions/chat.py` — Claude API conversation with Hank personality
- `app/actions/remember.py` — saves markdown files with frontmatter + post-processing
- `app/actions/post_processors/` — post-processor registry and implementations
- `LOG.md` — session-by-session progress log
- `plans/` — feature PRDs and designs
