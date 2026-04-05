# Mailgun: Email Interface for Hank

Email hank@hank.jorgepereira.io and get a reply — same as chatting on Telegram, but over email.

## How it works

```
You → email hank@hank.jorgepereira.io → Mailgun → POST /email → Processor → Mailgun API → reply lands in your inbox
```

1. You send an email to `hank@hank.jorgepereira.io`
2. Mailgun receives it (MX records point to Mailgun)
3. Mailgun forwards the email as a POST request to `https://hank.jorgepereira.io/email`
4. The bot parses the email (sender, subject, body), strips reply quotes
5. The body goes through the same processor as Telegram messages (Claude by default)
6. The bot replies via Mailgun's send API — the reply lands in your inbox

## What's already built

The code exists (`app/email_handler.py`). It handles:
- Receiving Mailgun inbound webhooks on `POST /email`
- Verifying the Mailgun signature (so nobody can fake inbound emails)
- Stripping reply quotes from email threads
- Routing through the processor (same as Telegram)
- Sending replies via Mailgun API
- Per-sender conversation history (keyed by hashed email address)

## What needs to be done

This is mostly configuration, not code:

### 1. Mailgun setup

1. Sign up at [mailgun.com](https://www.mailgun.com/)
2. Add and verify the domain `hank.jorgepereira.io`
3. Configure DNS records in Porkbun as Mailgun instructs:
   - MX records pointing to Mailgun's servers
   - TXT records for SPF and DKIM (so replies don't land in spam)
   - CNAME for tracking (optional)
4. Set up an inbound route in Mailgun:
   - **Match:** `match_recipient(".*@hank.jorgepereira.io")`
   - **Action:** forward to `https://hank.jorgepereira.io/email`

### 2. Environment variables

Add to `.env.cloud`:
```
MAILGUN_API_KEY=<your-mailgun-api-key>
MAILGUN_DOMAIN=hank.jorgepereira.io
MAILGUN_FROM=Hank <hank@hank.jorgepereira.io>
```

### 3. Deploy and test

1. Rebuild the bot with the new env vars
2. Send an email to `hank@hank.jorgepereira.io`
3. Check logs: `docker-compose logs -f hank`
4. Verify you get a reply email from Hank

## Security

- **Mailgun signature verification** — every inbound webhook includes a signature. The handler verifies it using the Mailgun API key, rejecting forged requests.
- **Sender restriction** — not currently implemented. Anyone who knows the email address can email Hank. Could add an `ALLOWED_EMAIL_SENDERS` allowlist later if needed (same pattern as `ALLOWED_USER_IDS` for Telegram).

## Future considerations

- Sender allowlist (restrict who can email Hank)
- HTML email replies (currently plain text only)
- Attachment handling (forward attachments to the memory feature once built)
- Email threading (proper In-Reply-To / References headers for cleaner threads)
