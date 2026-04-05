# Telegram VPS Bot

Telegram bot running in Docker on a VPS. Receives messages, processes them via Claude API, and replies. The bot is "Hank" — a friendly chat buddy powered by Claude.

## Setting Up a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name (e.g. "My VPS Bot")
4. Choose a username — must end in `bot` (e.g. `my_vps_bot`)
5. BotFather replies with your **bot token** — copy it
6. Paste the token into your `.env` file as `TELEGRAM_BOT_TOKEN`
7. Search for your bot's username in Telegram and start a chat with it
8. Run the app — any message you send to the bot should get a reply

To reset or manage your bot later, message @BotFather and use `/mybots`.

## Setting Up the Claude API

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Go to **API Keys** and create a new key
4. Paste it into your `.env` file as `ANTHROPIC_API_KEY`

The bot uses `claude-sonnet-4-20250514` by default. You can change the model in `app/processor.py`.

## Environment Configuration

There are two separate env files — one for local dev, one for cloud:

| File          | Example template      | Used for                          |
|---------------|-----------------------|-----------------------------------|
| `.env.local`  | `.env.local.example`  | Local dev & local Docker (polling)|
| `.env.cloud`  | `.env.cloud.example`  | VPS deployment (webhook)          |

Set them up:
```bash
cp .env.local.example .env.local   # local dev
cp .env.cloud.example .env.cloud   # cloud deploy
```

Docker Compose defaults to `.env.local`. To use `.env.cloud`:
```bash
ENV_FILE=.env.cloud docker-compose up -d
```

Both files are gitignored. See `.env.example` for a full reference of all variables.

## Stack

Python 3.12 · python-telegram-bot · anthropic · Docker

## Local Dev

```bash
python3 -m venv .venv && source .venv/bin/activate
cp .env.local.example .env.local
# Edit .env.local — set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
pip install -r requirements.txt
python -m app.main
```

Uses polling mode — no public URL needed.

## Testing Locally via Telegram

1. **Create the bot** — message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, and follow the prompts (see "Setting Up a Telegram Bot" above)
2. **Get a Claude API key** — create one at [console.anthropic.com](https://console.anthropic.com/) (see "Setting Up the Claude API" above)
3. **Configure `.env.local`** — copy the example and fill in your keys:
   ```bash
   cp .env.local.example .env.local
   ```
   Then edit `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=<your-bot-token-from-botfather>
   ANTHROPIC_API_KEY=<your-anthropic-api-key>
   MODE=polling
   ```
4. **Start the bot** — either directly or with Docker:
   ```bash
   # Direct
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   python -m app.main

   # Or with Docker
   docker-compose up --build
   ```
5. **Open Telegram** — search for your bot's username and open a chat with it
6. **Send a message** — type anything (e.g. "Hello!") and you should get a reply from Hank
7. **Check the terminal** — you'll see log output for each incoming message and outgoing reply

**Troubleshooting:**
- **No reply?** Check the terminal for errors. The most common issue is a missing or invalid bot token.
- **`Conflict: terminated by other getUpdates request`** — another instance of the bot is running (e.g. on your VPS). Stop it first, or use a different bot token for local dev.
- **`401 Unauthorized`** — your `TELEGRAM_BOT_TOKEN` is wrong. Regenerate it via @BotFather (`/mybots` → your bot → API Token → Revoke).
- **Claude errors** — verify your `ANTHROPIC_API_KEY` is valid and has credits at [console.anthropic.com](https://console.anthropic.com/).

## Local Docker

```bash
cp .env.local.example .env.local
# Edit .env.local — set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
docker-compose up --build
```

This builds the image and runs the bot in polling mode inside Docker. No public URL or HTTPS needed.

To run in the background:

```bash
docker-compose up --build -d
```

View logs:

```bash
docker-compose logs -f
```

Stop:

```bash
docker-compose down
```

## VPS Deployment

```bash
cp .env.cloud.example .env.cloud
# Edit .env.cloud — set TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, WEBHOOK_BASE_URL, TELEGRAM_WEBHOOK_SECRET
ENV_FILE=.env.cloud docker-compose up -d
```

Requires HTTPS (nginx + Let's Encrypt) in front of the container.

## Building with Claude Code

This project is built one phase at a time using Claude Code. Three files drive the workflow:

- **`PLAN.md`** — architecture, phases, and their status (`NOT STARTED` / `IN PROGRESS` / `DONE`)
- **`LOG.md`** — what was done each session, decisions made, blockers hit
- **`CLAUDE.md`** — instructions for Claude on how to work on this project

To continue building, open Claude Code in this directory and say "continue building". Claude reads all three files and picks up where it left off.
