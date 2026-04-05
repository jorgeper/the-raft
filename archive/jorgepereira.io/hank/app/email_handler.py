"""Mailgun inbound email handler.

Receives emails forwarded by Mailgun as HTTP POST webhooks and routes them
to different processors based on the recipient address:
- hank@hank.jorgepereira.io    → chat processor (Claude by default)
- remember@hank.jorgepereira.io → remember processor (saves to disk)

Replies are sent back via the Mailgun API.
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

# Processors injected by main.py during startup.
# _chat_processor handles normal conversation (hank@).
# _remember_processor handles memory saving (remember@).
_chat_processor: Processor | None = None
_remember_processor: Processor | None = None


def set_chat_processor(processor: Processor) -> None:
    """Inject the chat processor (for hank@ emails)."""
    global _chat_processor
    _chat_processor = processor


def set_remember_processor(processor: Processor) -> None:
    """Inject the remember processor (for remember@ emails)."""
    global _remember_processor
    _remember_processor = processor


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


def _extract_recipient_local(recipient: str) -> str:
    """Extract the local part (before @) from an email address.

    "remember@hank.jorgepereira.io" → "remember"
    "Hank <hank@hank.jorgepereira.io>" → "hank"
    """
    # Handle "Name <email>" format
    match = re.search(r"<([^>]+)>", recipient)
    if match:
        recipient = match.group(1)
    local = recipient.split("@")[0].lower().strip()
    return local


async def _send_reply(to: str, subject: str, body: str, from_addr: str | None = None) -> None:
    """Send a reply email via the Mailgun API.

    Uses the Mailgun HTTP API (not SMTP) to send the reply. This is simpler
    and doesn't require an SMTP connection.
    """
    domain = os.environ["MAILGUN_DOMAIN"]
    api_key = os.environ["MAILGUN_API_KEY"]
    if from_addr is None:
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
    return hmac.compare_digest(expected, signature)


def _format_memory(sender: str, subject: str, body: str) -> str:
    """Format an email into a markdown memory file.

    Returns a markdown string with the subject as the title,
    metadata (sender, date), and the email body.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    title = subject or "Untitled"

    return f"# {title}\n\n**From:** {sender}\n**Date:** {now}\n\n---\n\n{body}\n"


@router.post("/email")
async def handle_email(
    sender: str = Form(...),
    recipient: str = Form(default=""),
    subject: str = Form(default=""),
    body_plain: str = Form(default="", alias="body-plain"),
    token: str = Form(...),
    timestamp: str = Form(...),
    signature: str = Form(...),
):
    """Receive an inbound email from Mailgun.

    Routes to different processors based on the recipient address:
    - remember@... → RememberProcessor (saves to disk)
    - anything else → chat processor (Claude by default)
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

    logger.info("Email from %s to %s, subject: %s", sender, recipient, subject)

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

    # Route based on recipient address
    local_part = _extract_recipient_local(recipient)

    if local_part == "remember":
        # Remember processor — save the email content as a markdown file
        logger.info("Routing to remember processor")
        memory_text = _format_memory(sender, subject, text)
        chat_id = _email_chat_id(sender)
        reply = await _remember_processor.process(chat_id, memory_text)
        reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
        await _send_reply(sender, reply_subject, reply,
                          from_addr=f"Hank <remember@{os.environ['MAILGUN_DOMAIN']}>")
    else:
        # Default: chat processor (Claude)
        chat_id = _email_chat_id(sender)
        reply = await _chat_processor.process(chat_id, text)
        reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
        await _send_reply(sender, reply_subject, reply)

    return {"status": "ok"}
