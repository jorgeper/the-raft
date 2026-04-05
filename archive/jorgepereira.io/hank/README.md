# Hank — Telegram Bot

Telegram bot powered by Claude. Receives messages, processes them via the Anthropic API, and replies as "Hank" — a friendly chat buddy.

Deployed at `hank.jorgepereira.io`. For deployment instructions, see the [parent README](../README.md).

## Setting Up a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name (e.g. "Hank")
4. Choose a username — must end in `bot` (e.g. `hank_chat_bot`)
5. BotFather replies with your **bot token** — copy it
6. Paste the token into your `.env.local` file as `TELEGRAM_BOT_TOKEN`

To reset or manage your bot later, message @BotFather and use `/mybots`.

## Setting Up the Claude API

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Go to **API Keys** and create a new key
4. Paste it into your `.env.local` file as `ANTHROPIC_API_KEY`

The bot uses `claude-sonnet-4-20250514` by default. You can change the model in `app/processors/claude.py`.

## Environment Configuration

| File              | Example template       | Used for              |
|-------------------|------------------------|-----------------------|
| `.env.local`      | `.env.local.example`   | Local dev (polling)   |
| `.env.cloud`      | `.env.cloud.example`   | VPS (webhook)         |

Both files are gitignored. See `.env.example` for a full reference of all variables.

## Local Dev

```bash
cd hank
cp .env.local.example .env.local
# Edit .env.local — set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

Uses polling mode — no public URL needed.

## Testing Locally via Telegram

1. **Create the bot** — see "Setting Up a Telegram Bot" above
2. **Get a Claude API key** — see "Setting Up the Claude API" above
3. **Configure `.env.local`**:
   ```bash
   cp .env.local.example .env.local
   ```
   Then edit `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=<your-bot-token-from-botfather>
   ANTHROPIC_API_KEY=<your-anthropic-api-key>
   MODE=polling
   ```
4. **Start the bot**:
   ```bash
   python -m app.main
   ```
5. **Open Telegram** — search for your bot's username and open a chat with it
6. **Send a message** — type anything (e.g. "Hello!") and you should get a reply from Hank
7. **Check the terminal** — you'll see log output for each incoming message and outgoing reply

**Troubleshooting:**
- **No reply?** Check the terminal for errors. The most common issue is a missing or invalid bot token.
- **`Conflict: terminated by other getUpdates request`** — another instance of the bot is running (e.g. on your VPS). Stop it first, or use a different bot token for local dev.
- **`401 Unauthorized`** — your `TELEGRAM_BOT_TOKEN` is wrong. Regenerate it via @BotFather (`/mybots` → your bot → API Token → Revoke).
- **Claude errors** — verify your `ANTHROPIC_API_KEY` is valid and has credits at [console.anthropic.com](https://console.anthropic.com/).

## Security

The bot has two layers of protection:

**Layer 1 — Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`): Verifies that incoming HTTP requests to `hank.jorgepereira.io/telegram` actually come from Telegram. Without this, anyone who knows the URL could send fake message payloads to your server. Telegram includes this secret in a header with every request, and the bot rejects anything that doesn't match.

**Layer 2 — User allowlist** (`ALLOWED_USER_IDS`): Controls who can chat with the bot through Telegram. Even with a valid webhook secret (the request is genuinely from Telegram), anyone who finds your bot on Telegram can message it. The allowlist restricts it to specific Telegram accounts.

### Configuring allowed users

1. **Find your Telegram user ID** — message the bot and check the logs:
   ```bash
   docker-compose logs -f hank
   ```
   You'll see: `Message from Jorge (id=123456789)` — that number is your ID.

2. **Add it to your env file** — set `ALLOWED_USER_IDS` as a comma-separated list:
   ```
   ALLOWED_USER_IDS=123456789
   ```
   To allow multiple users:
   ```
   ALLOWED_USER_IDS=123456789,987654321
   ```

3. **Restart the bot** to apply:
   ```bash
   docker-compose up -d --build hank
   ```

If `ALLOWED_USER_IDS` is empty or not set, the bot accepts messages from anyone.

Blocked users are silently ignored — the bot logs a warning but doesn't reply.

## Stack

Python 3.12 · python-telegram-bot · anthropic · FastAPI

## Building with Claude Code

This project is built one phase at a time using Claude Code. Three files drive the workflow:

- **`PLAN.md`** — architecture, phases, and their status (`NOT STARTED` / `IN PROGRESS` / `DONE`)
- **`LOG.md`** — what was done each session, decisions made, blockers hit
- **`CLAUDE.md`** — instructions for Claude on how to work on this project

To continue building, open Claude Code in this directory and say "continue building". Claude reads all three files and picks up where it left off.
