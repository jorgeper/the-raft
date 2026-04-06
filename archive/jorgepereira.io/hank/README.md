# Hank

A chat bot powered by Claude with three interfaces — Telegram, email, and a web UI. Send a message on Telegram or email `hank@hank.jorgepereira.io` and get a reply from "Hank", a friendly chat buddy.

You can also email `remember@hank.jorgepereira.io` to save things — Hank stores the email content as markdown files on disk. Browse saved memories at `https://hank.jorgepereira.io/app` (Google OAuth required).

Deployed at `hank.jorgepereira.io`. For deployment instructions, see the [parent README](../README.md).

The web UI runs as a separate container (`hank-web/`) — see the [parent README](../README.md) for architecture details.

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

## Remember Feature

Tell Hank to remember something — via Telegram or email — and he saves it as a markdown file on disk.

**Ways to trigger remember:**

| Channel | How | Intent detection |
|---------|-----|-----------------|
| Telegram | "Remember this: wifi password is trout42" | Claude detects "remember" intent |
| Email to `hank@` | "Remember this email" + forwarded content | Claude detects "remember" intent |
| Email to `remember@` | Just send/forward — everything gets saved | Shortcut, no LLM needed |

**How it works:**
- Hank uses Claude to classify every message as "chat" or "remember"
- If "remember": extracts the content to save, writes it to disk, replies "Got it, I'll remember that."
- If "chat": normal conversation
- The `remember@` shortcut skips intent detection entirely — everything sent to that address gets saved

**Storage:** Memories are markdown files with YAML frontmatter (Obsidian-style) in `data/{identity}/memories/YYYY-MM-DD/`. Stored in a Docker volume (`hank_data`) so they persist across container rebuilds. URL memories are post-processed to fetch the page title. Each user's memories are isolated by identity (see [Identities](#identities) below).

```bash
# Browse saved memories on the VPS
docker-compose exec hank ls data/jorge/memories/
docker-compose exec hank cat data/jorge/memories/2026-04-05/2026-04-05T21-33-02_wifi-password.md
```

### Downloading memories

To download all memories to your local machine:

```bash
# On the VPS: copy from container to a temp directory
docker cp $(docker ps -q --filter name=hank):/app/data/memories /tmp/memories

# On your local machine: download via scp
scp -r jorge@<your-vps-ip>:/tmp/memories ./memories
```

## Identities

Hank supports multiple users. Each user is an **identity** with their own isolated memories, conversation history, and web UI access. Identities are defined in `identities.json`.

### Identity format

Edit `hank/identities.json` (gitignored — your real config):

```json
[
  {
    "id": "jorge",
    "name": "Jorge",
    "telegram_ids": [123456789],
    "emails": ["jorge@gmail.com"]
  },
  {
    "id": "alex",
    "name": "Alex",
    "telegram_ids": [987654321],
    "emails": ["alex@example.com"]
  }
]
```

Each identity needs:
- `id` — unique slug, used as the data directory name (`data/jorge/memories/`)
- `name` — display name (for logs)
- `telegram_ids` — list of Telegram user IDs (find yours in the bot logs: `Message from Jorge (id=123456789)`)
- `emails` — list of email addresses (used for email access and web UI OAuth)

See `identities.json.example` for a full example.

### First-time setup

On first boot with a fresh volume, the Dockerfile auto-copies `hank/identities.json` into the data volume:

```bash
docker-compose up -d --build
```

### Updating identities

When you add, remove, or change a user:

1. **Edit `hank/identities.json`** on the server (or locally and `scp`/`git pull` it)

2. **Push the updated file into the running container** and restart:

   ```bash
   docker-compose exec hank cp identities.json data/identities.json
   docker-compose restart hank hank-web
   ```

   The restart is needed because both hank and hank-web load identities at startup.

3. **Verify it loaded correctly:**

   ```bash
   docker-compose logs hank 2>&1 | grep -i identit
   docker-compose logs hank-web 2>&1 | grep -i identit
   ```

   You should see each identity listed with its Telegram IDs and emails.

### Finding a user's Telegram ID

Have the user message the bot, then check the logs:

```bash
docker-compose logs -f hank
```

You'll see: `Incoming message from Jorge (id=123456789)` — that number is their Telegram user ID. Add it to `identities.json` and follow the update steps above.

### How identity resolution works

| Channel  | Lookup key | What happens if not found |
|----------|-----------|---------------------------|
| Telegram | User ID from the message | Message silently blocked |
| Email    | Sender email address | Email silently blocked |
| Web UI   | Email from Google OAuth | Login denied (403) |

The identity registry replaces the old `ALLOWED_USER_IDS`, `ALLOWED_EMAIL_SENDERS`, and `ALLOWED_EMAIL` env vars — those are no longer used.

### Data isolation

Each identity gets its own directory under `data/`:

```
data/
├── identities.json
├── jorge/
│   └── memories/
│       ├── 2026-04-05/
│       │   └── ...
│       └── index.json
└── alex/
    └── memories/
        └── ...
```

Memories, search indexes, and conversation history are all scoped per identity. Users cannot see each other's data.

## Security

### Telegram

**Layer 1 — Webhook secret** (`TELEGRAM_WEBHOOK_SECRET`): Verifies that incoming HTTP requests to `/telegram` actually come from Telegram. Without this, anyone who knows the URL could send fake message payloads. Telegram includes this secret in a header with every request, and the bot rejects anything that doesn't match.

**Layer 2 — Identity registry**: Controls who can chat with the bot. Only Telegram users whose ID appears in `identities.json` can interact with Hank. Unknown users are silently ignored.

### Email

**Mailgun signature verification**: Every inbound email webhook includes a cryptographic signature. The bot verifies it using HMAC-SHA256 with the Mailgun API key, rejecting forged requests. This prevents anyone from POSTing fake emails to the `/email` endpoint.

**Identity registry**: Only email addresses listed in `identities.json` are accepted. Emails from unknown senders are silently blocked.

### Web UI

**Google OAuth + identity registry**: Users must authenticate via Google and their email must match an identity in `identities.json`. Each authenticated user only sees their own memories.

## Setting Up Google OAuth (Web UI)

The web UI at `hank.jorgepereira.io/app` requires Google OAuth for authentication. This is configured in the `hank-web` container.

### 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Hank") or use an existing one
3. Go to **APIs & Services → OAuth consent screen**
4. Choose **External** user type
5. Fill in the app name ("Hank"), your email for support contact
6. Add your email to **Test users** (required while in testing mode)
7. Save

### 2. Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: "Hank Web"
5. **Authorized JavaScript origins:** `https://hank.jorgepereira.io`
6. **Authorized redirect URIs:** `https://hank.jorgepereira.io/auth/callback`
7. Click **Create** and copy the **Client ID** and **Client Secret**

### 3. Configure hank-web

On the VPS, create `hank-web/.env.cloud`:

```bash
cp hank-web/.env.cloud.example hank-web/.env.cloud
nano hank-web/.env.cloud
```

Set:
```
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
SESSION_SECRET=<run: openssl rand -hex 32>
```

Access is controlled by `identities.json` (see [Identities](#identities)) — only users whose email matches an identity can log in.

### 4. Deploy

```bash
docker rm -f $(docker ps -aq --filter name=hank-web)
docker-compose up -d --build hank-web
```

Visit `https://hank.jorgepereira.io` — it'll redirect to Google login.

## Stack

Python 3.12 · python-telegram-bot · anthropic · FastAPI

## Cleanup

If you want to fully tear down Hank, here's everything to clean up:

### VPS (Hostinger)
```bash
cd /opt/sandbox/jorgepereira.io
docker-compose down -v  # -v removes volumes (deletes all memories!)
```

### DNS (Porkbun)
- Delete the `hank` A record
- Delete the MX records for `hank` (mxa.mailgun.org, mxb.mailgun.org)
- Delete the TXT records for `hank` (SPF, DKIM, DMARC)

### Telegram
- Message [@BotFather](https://t.me/BotFather) → `/deletebot` → select your bot

### Mailgun
- Go to [mailgun.com](https://www.mailgun.com) → **Sending → Domains**
- Delete `hank.jorgepereira.io`
- Go to **Receiving** → delete the inbound route

### Google Cloud
- Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
- Delete the OAuth 2.0 Client ID for "Hank Web"
- Optionally delete the project if it was created just for Hank

### Anthropic
- Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys**
- Revoke the key used for Hank (if it's dedicated to Hank)

### GitHub
- The code stays in the repo — no cleanup needed unless you want to delete the `hank/` and `hank-web/` directories

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
