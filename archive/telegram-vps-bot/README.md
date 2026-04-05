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

## Stack

Python 3.12 · python-telegram-bot · anthropic · Docker

## Local Dev

```bash
python3 -m venv .venv & source .venv/bin/activate
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, and MODE=polling
pip install -r requirements.txt
python -m app.main
```

Uses polling mode — no public URL needed.

## VPS Deployment

```bash
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, MODE=webhook, WEBHOOK_BASE_URL
docker-compose up -d
```

Requires HTTPS (nginx + Let's Encrypt) in front of the container.

## Building with Claude Code

This project is built one phase at a time using Claude Code. Three files drive the workflow:

- **`PLAN.md`** — architecture, phases, and their status (`NOT STARTED` / `IN PROGRESS` / `DONE`)
- **`LOG.md`** — what was done each session, decisions made, blockers hit
- **`CLAUDE.md`** — instructions for Claude on how to work on this project

To continue building, open Claude Code in this directory and say "continue building". Claude reads all three files and picks up where it left off.
