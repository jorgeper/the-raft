"""Mailgun inbound email handler.

Receives emails forwarded by Mailgun as HTTP POST webhooks, routes them
through the same processor as Telegram messages, and sends replies via
the Mailgun API.

Flow:
1. Someone emails hank@hank.jorgepereira.io
2. Mailgun receives it (MX records point to Mailgun)
3. Mailgun POSTs the email to https://hank.jorgepereira.io/email
4. We verify the Mailgun signature, strip reply quotes, extract the body
5. Body goes through the processor (same as Telegram messages)
6. We send the reply back via Mailgun's send API
"""

import hashlib
import hmac
import logging
import os
import re

import httpx
from fastapi import APIRouter, Form, HTTPException

from app.processor import Processor

logger = logging.getLogger(__name__)

router = APIRouter()

# The processor instance, set by main.py during startup.
# Same instance used by both Telegram and email — messages go through
# the exact same processing logic regardless of channel.
_processor: Processor | None = None


def set_processor(processor: Processor) -> None:
    """Inject the processor instance. Called once during app startup."""
    global _processor
    _processor = processor


def _email_chat_id(email: str) -> int:
    """Derive a stable numeric chat_id from an email address.

    We hash the email so each sender gets their own conversation history,
    just like each Telegram chat has its own. The hash is deterministic,
    so the same sender always maps to the same chat_id.
    """
    return int(hashlib.sha256(email.encode()).hexdigest()[:15], 16)


def _strip_reply_quotes(body: str) -> str:
    """Strip quoted reply text from email body, keep only the new content.

    When someone replies to Hank's email, their email client includes the
    previous conversation below. We strip that out so the processor only
    sees the new message, not the entire thread.
    """
    for pattern in [
        r"\n>.*",                    # lines starting with > (quoted text)
        r"\nOn .+ wrote:.*",        # "On <date> <person> wrote:" (Gmail style)
        r"\n-{2,}\s*Original Message.*",  # "-- Original Message --" (Outlook style)
    ]:
        body = re.split(pattern, body, maxsplit=1, flags=re.DOTALL)[0]
    return body.strip()


async def _send_reply(to: str, subject: str, body: str) -> None:
    """Send a reply email via the Mailgun API.

    Uses the Mailgun HTTP API (not SMTP) to send the reply. This is simpler
    and doesn't require an SMTP connection.
    """
    domain = os.environ["MAILGUN_DOMAIN"]
    api_key = os.environ["MAILGUN_API_KEY"]
    from_addr = os.getenv("MAILGUN_FROM", f"Hank <hank@{domain}>")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.mailgun.net/v3/{domain}/messages",
            auth=("api", api_key),
            data={
                "from": from_addr,
                "to": to,
                "subject": subject,
                "text": body,
            },
        )
        resp.raise_for_status()
        logger.info("Sent reply email to %s", to)


def _verify_mailgun_signature(token: str, timestamp: str, signature: str) -> bool:
    """Verify that an inbound webhook actually came from Mailgun.

    Mailgun signs every webhook with HMAC-SHA256 using the webhook signing key.
    We recompute the signature and compare — if it doesn't match,
    someone is trying to send fake emails to our endpoint.

    The signing key is found in Mailgun under Settings → API Keys → Webhook Signing Key.
    This is different from the API key used for sending.
    """
    signing_key = os.environ.get("MAILGUN_WEBHOOK_SIGNING_KEY", os.environ.get("MAILGUN_API_KEY", ""))
    expected = hmac.HMAC(
        signing_key.encode(), f"{timestamp}{token}".encode(), hashlib.sha256
    ).hexdigest()
    logger.info("Mailgun sig check: key_len=%d, expected=%s..., got=%s...", len(signing_key), expected[:16], signature[:16])
    return hmac.compare_digest(expected, signature)


@router.post("/email")
async def handle_email(
    sender: str = Form(...),
    subject: str = Form(default=""),
    body_plain: str = Form(default="", alias="body-plain"),
    token: str = Form(...),
    timestamp: str = Form(...),
    signature: str = Form(...),
):
    """Receive an inbound email from Mailgun.

    Mailgun sends the email as form data with fields like sender, subject,
    body-plain, plus a signature (token + timestamp + signature) for verification.
    """
    # Verify the request is actually from Mailgun
    try:
        sig_valid = _verify_mailgun_signature(token, timestamp, signature)
    except Exception as e:
        logger.error("Mailgun signature verification error: %s", e)
        raise HTTPException(status_code=500, detail="Signature verification error")
    if not sig_valid:
        logger.warning("Invalid Mailgun signature from %s", sender)
        raise HTTPException(status_code=403, detail="Invalid signature")

    logger.info("Email from %s, subject: %s", sender, subject)

    # Check sender allowlist — if configured, only accept emails from these addresses.
    allowed_senders_str = os.getenv("ALLOWED_EMAIL_SENDERS", "")
    allowed_senders = {s.strip().lower() for s in allowed_senders_str.split(",") if s.strip()}
    if allowed_senders and sender.lower() not in allowed_senders:
        logger.warning("Blocked email from %s (not in ALLOWED_EMAIL_SENDERS)", sender)
        return {"status": "blocked"}

    # Strip quoted reply text — we only want the new content
    text = _strip_reply_quotes(body_plain)
    if not text:
        logger.info("Empty email body, skipping")
        return {"status": "skipped"}

    # Route through the processor — same path as Telegram messages.
    # Each sender gets their own conversation history (keyed by hashed email).
    chat_id = _email_chat_id(sender)
    reply = await _processor.process(chat_id, text)

    # Send the reply back via Mailgun
    reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
    await _send_reply(sender, reply_subject, reply)

    return {"status": "ok"}
