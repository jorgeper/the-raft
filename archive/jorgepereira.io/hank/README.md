# Hank

A chat bot powered by Claude with two interfaces — Telegram and email. Send a message on Telegram or email `hank@hank.jorgepereira.io` and get a reply from "Hank", a friendly chat buddy.

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

## Setting Up Mailgun (Email)

This lets people email `hank@hank.jorgepereira.io` and get a reply. The code is already built — this is just configuration.

### 1. Create a Mailgun account

1. Sign up at [mailgun.com](https://www.mailgun.com/)
2. Go to **Sending** → **Domains** → **Add New Domain**
3. Add `hank.jorgepereira.io`

### 2. Configure DNS records in Porkbun

Mailgun will show you the DNS records to add. Go to [porkbun.com](https://porkbun.com) → **Domain Management** → **DNS** next to `jorgepereira.io` and add them:

**MX records** (so Mailgun receives email for this domain):

| Type | Name | Priority | Value |
|------|------|----------|-------|
| MX | `hank` | 10 | `mxa.mailgun.org` |
| MX | `hank` | 10 | `mxb.mailgun.org` |

**TXT records** (so replies don't land in spam):

| Type | Name | Value |
|------|------|-------|
| TXT | `hank` | `v=spf1 include:mailgun.org ~all` |
| TXT | `mailo._domainkey.hank` | *(DKIM key from Mailgun — long string)* |

Mailgun will verify these automatically. Check the domain page — all records should show green.

### 3. Set up inbound routing

In Mailgun, go to **Receiving** → **Create Route**:

| Field | Value |
|-------|-------|
| **Expression Type** | Match Recipient |
| **Recipient** | `.*@hank.jorgepereira.io` |
| **Action** | Forward to `https://hank.jorgepereira.io/email` |

This tells Mailgun: when anyone emails `*@hank.jorgepereira.io`, POST the email to our webhook endpoint.

### 4. Add env vars

Add these to your `.env.cloud` on the VPS:

```
MAILGUN_API_KEY=<your-mailgun-api-key>
MAILGUN_WEBHOOK_SIGNING_KEY=<your-webhook-signing-key>
MAILGUN_DOMAIN=hank.jorgepereira.io
MAILGUN_FROM=Hank <hank@hank.jorgepereira.io>
```

Find both keys in Mailgun under **Settings** → **API Keys**:
- **API Key** — used to send emails via the Mailgun API
- **Webhook Signing Key** — used to verify inbound webhook signatures (different from the API key)

### 5. Deploy and test

```bash
docker rm -f $(docker ps -aq --filter name=hank)
docker-compose up -d --build hank
```

Send an email to `hank@hank.jorgepereira.io` and check the logs:

```bash
docker-compose logs -f hank
```

You should see the inbound email logged and a reply sent back to your inbox.

**Troubleshooting:**
- **No email received by Mailgun?** DNS records haven't propagated. Check Mailgun's domain verification page.
- **Mailgun posts but gets 403?** The signature verification is failing — make sure `MAILGUN_API_KEY` in `.env.cloud` matches the key Mailgun is signing with.
- **Reply lands in spam?** SPF and DKIM DNS records may not be set up correctly. Check Mailgun's domain page for verification status.

## Security

### Telegram

**Layer 1 — Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`): Verifies that incoming HTTP requests to `/telegram` actually come from Telegram. Without this, anyone who knows the URL could send fake message payloads. Telegram includes this secret in a header with every request, and the bot rejects anything that doesn't match.

**Layer 2 — User allowlist** (`ALLOWED_USER_IDS`): Controls who can chat with the bot. Even with a valid webhook secret, anyone who finds your bot on Telegram can message it. The allowlist restricts it to specific Telegram accounts.

### Email

**Mailgun signature verification**: Every inbound email webhook includes a cryptographic signature. The bot verifies it using HMAC-SHA256 with the Mailgun API key, rejecting forged requests. This prevents anyone from POSTing fake emails to the `/email` endpoint.

**Sender allowlist** (`ALLOWED_EMAIL_SENDERS`): Comma-separated list of email addresses allowed to email Hank. If empty or not set, anyone can email. Blocked senders are silently ignored with a warning in the logs.
```
ALLOWED_EMAIL_SENDERS=you@gmail.com,friend@example.com
```

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

This project is built using Claude Code. Key files:

- **`CLAUDE.md`** — instructions for Claude on how to work on this project
- **`ARCHITECTURE.md`** — technical architecture details
- **`LOG.md`** — what was done each session, decisions made, blockers hit
- **`plans/<FEATURE>.md`** — feature requirements (e.g. `memory.prd.md`)
- **`plans/<FEATURE>.design.md`** — technical design for a feature

### Feature workflow

1. **PRD** — write `plans/<FEATURE>.md` defining what to build, iterate until happy
2. **Design** — write `plans/<FEATURE>.design.md` defining how to build it, iterate until happy
3. **Build** — implement the feature, log progress in `LOG.md`
