"""Mailgun inbound email handler.

Receives emails forwarded by Mailgun as HTTP POST webhooks and routes them
to the processor with different intents based on the recipient address:
- hank@hank.jorgepereira.io    → intent=None (HankProcessor detects it via Claude)
- remember@hank.jorgepereira.io → intent="remember" (skips detection, saves directly)

Replies are sent back via the Mailgun API.
"""

import hashlib
import hmac
import logging
import os
import re

import httpx
from fastapi import APIRouter, Form, HTTPException

from app.actions.remember import MemoryMetadata
from app.message import render_response
from app.processor import Processor

logger = logging.getLogger(__name__)

router = APIRouter()

# The processor instance, set by main.py during startup.
# Same instance handles all emails — routing is done via the intent parameter.
_processor: Processor | None = None


def set_processor(processor: Processor) -> None:
    """Inject the processor instance. Called once during app startup."""
    global _processor
    _processor = processor


def _email_chat_id(email: str) -> int:
    """Derive a stable numeric chat_id from an email address.

    We hash the email so each sender gets their own conversation history,
    just like each Telegram chat has its own.
    """
    return int(hashlib.sha256(email.encode()).hexdigest()[:15], 16)


def _strip_reply_quotes(body: str) -> str:
    """Strip quoted reply text from email body, keep only the new content."""
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
    match = re.search(r"<([^>]+)>", recipient)
    if match:
        recipient = match.group(1)
    return recipient.split("@")[0].lower().strip()


async def _format_email_for_storage(sender: str, subject: str, body_plain: str, body_html: str = "") -> tuple[str, str | None]:
    """Format a full email for storage.

    Returns:
        (markdown_text, html_content) — markdown is always returned (for the processor
        and plain text previews). html_content is the raw HTML if available (saved
        alongside as a .html file for full fidelity).
    """
    title = subject or "Untitled"
    md = f"# {title}\n\n**From:** {sender}\n\n{body_plain}"
    return md, body_html or None


async def _send_reply(to: str, subject: str, body: str, from_addr: str | None = None, html: bool = False) -> None:
    """Send a reply email via the Mailgun API.

    Args:
        html: If True, send body as HTML instead of plain text.
    """
    domain = os.environ["MAILGUN_DOMAIN"]
    api_key = os.environ["MAILGUN_API_KEY"]
    if from_addr is None:
        from_addr = os.getenv("MAILGUN_FROM", f"Hank <hank@{domain}>")

    data = {
        "from": from_addr,
        "to": to,
        "subject": subject,
    }
    if html:
        data["html"] = body
    else:
        data["text"] = body

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.mailgun.net/v3/{domain}/messages",
            auth=("api", api_key),
            data=data,
        )
        resp.raise_for_status()
        logger.info("Sent reply email to %s (html=%s)", to, html)


def _verify_mailgun_signature(token: str, timestamp: str, signature: str) -> bool:
    """Verify that an inbound webhook actually came from Mailgun."""
    signing_key = os.environ.get("MAILGUN_WEBHOOK_SIGNING_KEY", os.environ.get("MAILGUN_API_KEY", ""))
    expected = hmac.HMAC(
        signing_key.encode(), f"{timestamp}{token}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/email")
async def handle_email(
    sender: str = Form(...),
    recipient: str = Form(default=""),
    subject: str = Form(default=""),
    body_plain: str = Form(default="", alias="body-plain"),
    body_html: str = Form(default="", alias="body-html"),
    token: str = Form(...),
    timestamp: str = Form(...),
    signature: str = Form(...),
):
    """Receive an inbound email from Mailgun.

    Routes to the processor with different intents based on recipient:
    - remember@... → intent="remember" (skip detection, save directly)
    - anything else → intent=None (HankProcessor detects via Claude)
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

    # Check sender allowlist
    allowed_senders_str = os.getenv("ALLOWED_EMAIL_SENDERS", "")
    allowed_senders = {s.strip().lower() for s in allowed_senders_str.split(",") if s.strip()}
    if allowed_senders and sender.lower() not in allowed_senders:
        logger.warning("Blocked email from %s (not in ALLOWED_EMAIL_SENDERS)", sender)
        return {"status": "blocked"}

    # Strip quoted reply text
    text = _strip_reply_quotes(body_plain)
    if not text:
        logger.info("Empty email body, skipping")
        return {"status": "skipped"}

    # Determine routing based on recipient address and message content
    local_part = _extract_recipient_local(recipient)
    chat_id = _email_chat_id(sender)

    # Check if the first line is a slash command (e.g. "/echo hello")
    first_line = text.split("\n")[0].strip()
    if first_line.startswith("/"):
        from app.commands import handle_command
        logger.info("Email contains slash command: %s", first_line)
        response = await handle_command(first_line, chat_id, channel="email")
        reply, is_html = render_response(response, "email")
        reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
        await _send_reply(sender, reply_subject, reply, html=is_html)
    elif local_part == "remember":
        # remember@ shortcut — save the full email, no LLM.
        logger.info("remember@ shortcut — saving directly")
        md_text, html_content = await _format_email_for_storage(sender, subject, text, body_html)
        meta = MemoryMetadata(medium="email-remember", source=sender)
        meta.html_content = html_content
        response = await _processor.process(chat_id, md_text, intent="remember", metadata=meta)
        reply, is_html = render_response(response, "email")
        reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
        await _send_reply(sender, reply_subject, reply,
                          from_addr=f"Hank <remember@{os.environ['MAILGUN_DOMAIN']}>",
                          html=is_html)
    else:
        # Default: let HankProcessor detect the intent (chat or remember).
        meta = MemoryMetadata(medium="email", source=sender)
        md_text, html_content = await _format_email_for_storage(sender, subject, text, body_html)
        meta.html_content = html_content
        full_email = md_text
        response = await _processor.process(chat_id, full_email, metadata=meta)
        reply, is_html = render_response(response, "email")
        reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
        await _send_reply(sender, reply_subject, reply, html=is_html)

    return {"status": "ok"}
