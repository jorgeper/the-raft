# jorgepereira.io

Everything that runs under the `jorgepereira.io` domain — the main website and the Hank Telegram bot.

## Architecture

```
Internet
  │
  ▼
┌─────────────────────────────────────────────┐
│  Caddy (ports 80 + 443)                     │
│  Automatic HTTPS via Let's Encrypt          │
│                                             │
│  jorgepereira.io      → site container :80  │
│  hank.jorgepereira.io → hank container :8000│
└─────────────────────────────────────────────┘
```

Three Docker containers managed by docker-compose:

| Service | What it does | Internal port |
|---------|-------------|---------------|
| **caddy** | Reverse proxy + HTTPS termination | 80, 443 (exposed) |
| **site** | Static website (nginx) | 80 (internal) |
| **hank** | Telegram bot (FastAPI) | 8000 (internal) |

## How HTTPS and the reverse proxy work

HTTPS encrypts traffic between the browser and the server. To prove the server is legitimate, it needs a **certificate** signed by a trusted authority (like Let's Encrypt).

**Caddy** is a web server that handles all of this automatically:
1. It requests a certificate from Let's Encrypt for each domain in the Caddyfile
2. It proves ownership by responding to a challenge on port 80
3. It serves traffic over HTTPS on port 443
4. It renews certificates before they expire

**Reverse proxy** means Caddy sits in front of the other containers and forwards requests based on the domain name:

```
Browser → https://jorgepereira.io → Caddy → (decrypts) → site:80 (plain HTTP)
Browser → https://hank.jorgepereira.io → Caddy → (decrypts) → hank:8000 (plain HTTP)
```

The site and bot containers never deal with HTTPS — they serve plain HTTP internally. Caddy handles all the encryption. This is configured in the `Caddyfile`:

```
jorgepereira.io {
    reverse_proxy site:80
}

hank.jorgepereira.io {
    reverse_proxy hank:8000
}
```

Docker networking lets Caddy reach the other containers by service name (`site`, `hank`).

## Project structure

```
jorgepereira.io/
├── Caddyfile              # Shared Caddy config — routes domains to services
├── docker-compose.yml     # All three services
├── site/                  # jorgepereira.io static website
│   ├── Dockerfile         # nginx serving static files
│   └── html/
│       ├── index.html
│       ├── demos.html
│       ├── wind.html
│       └── wisy.html
└── hank/                  # hank.jorgepereira.io Telegram bot
    ├── Dockerfile
    ├── requirements.txt
    ├── CLAUDE.md
    ├── PLAN.md
    ├── LOG.md
    ├── README.md          # Hank-specific docs (setup, processors, testing)
    ├── .env.example
    ├── .env.local.example
    ├── .env.cloud.example
    └── app/
        ├── main.py
        ├── bot.py
        ├── processor.py
        ├── email_handler.py
        └── processors/
            ├── claude.py
            └── helloworld.py
```

## Local development

### Run the site only

```bash
cd site
docker build -t jorgepereira-site .
docker run -d -p 3000:80 --name jorgepereira-site jorgepereira-site
```

Open http://localhost:3000

### Run the bot only

```bash
cd hank
cp .env.local.example .env.local
# Edit .env.local — set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

### Run everything with docker-compose

```bash
cp hank/.env.local.example hank/.env.local
# Edit hank/.env.local — set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
docker-compose up --build
```

This starts all three services. Locally, Caddy won't be able to get certificates (no public domain), but the site and bot still work:
- Site: http://localhost:80
- Bot: communicates via Telegram polling (no web access needed)

## VPS deployment (Hostinger)

### One-time setup

Do this once to get the VPS ready.

**Prerequisites:**
- Hostinger VPS with SSH access
- Docker and Docker Compose installed
- DNS: `jorgepereira.io` and `hank.jorgepereira.io` A records pointing to your VPS IP

**1. Clone the repo:**

```bash
ssh jorge@<your-vps-ip>
sudo git clone https://github.com/jorgeper/sandbox.git /opt/sandbox
sudo chown -R jorge:jorge /opt/sandbox
cd /opt/sandbox/jorgepereira.io
```

**2. Configure the bot environment:**

```bash
cp hank/.env.cloud.example hank/.env.cloud
nano hank/.env.cloud
```

Set these values:
```
TELEGRAM_BOT_TOKEN=<your-bot-token>
ANTHROPIC_API_KEY=<your-api-key>
MODE=webhook
PROCESSOR=claude
WEBHOOK_BASE_URL=https://hank.jorgepereira.io
TELEGRAM_WEBHOOK_SECRET=<generate-a-random-string>
```

Generate a random secret:
```bash
openssl rand -hex 32
```

**3. Set the default env file** so you don't have to pass `ENV_FILE=` on every command:

```bash
echo "ENV_FILE=hank/.env.cloud" > .env
```

**4. Start everything:**

```bash
docker-compose up -d --build
```

Caddy will automatically obtain Let's Encrypt certificates for both domains.

**5. Verify:**

```bash
docker-compose ps
curl https://jorgepereira.io
curl https://hank.jorgepereira.io/health
```

---

### Deploying site changes

After pushing HTML changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker-compose up -d --build site
```

### Deploying bot changes

After pushing bot code changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker-compose up -d --build hank
```

### Deploying Caddy config changes

After pushing Caddyfile changes to `main`:

```bash
ssh jorge@<your-vps-ip>
cd /opt/sandbox/jorgepereira.io
git pull
docker-compose restart caddy
```

---

### Useful commands

```bash
docker-compose ps                  # status of all services
docker-compose logs -f hank        # follow bot logs
docker-compose logs -f site        # follow site logs
docker-compose logs -f caddy       # follow Caddy logs
docker-compose restart hank        # restart just the bot
docker-compose stop hank           # stop the bot (site stays up)
docker-compose start hank          # start it again
```

## Adding a new service

To add another subdomain (e.g. `foo.jorgepereira.io`):

1. Create a `foo/` directory with a Dockerfile
2. Add the service to `docker-compose.yml`
3. Add a block to the `Caddyfile`:
   ```
   foo.jorgepereira.io {
       reverse_proxy foo:<port>
   }
   ```
4. Add a DNS A record for `foo.jorgepereira.io` pointing to the VPS
5. Redeploy — Caddy will automatically get a certificate for the new domain
