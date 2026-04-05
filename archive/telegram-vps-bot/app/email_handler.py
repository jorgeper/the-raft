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

# Set by main.py during startup
_processor: Processor | None = None


def set_processor(processor: Processor) -> None:
    global _processor
    _processor = processor


def _email_chat_id(email: str) -> int:
    """Derive a stable numeric chat_id from an email address."""
    return int(hashlib.sha256(email.encode()).hexdigest()[:15], 16)


def _strip_reply_quotes(body: str) -> str:
    """Strip quoted reply text from email body, keep only the new content."""
    for pattern in [
        r"\n>.*",                    # lines starting with >
        r"\nOn .+ wrote:.*",        # "On <date> <person> wrote:"
        r"\n-{2,}\s*Original Message.*",  # -- Original Message --
    ]:
        body = re.split(pattern, body, maxsplit=1, flags=re.DOTALL)[0]
    return body.strip()


async def _send_reply(to: str, subject: str, body: str) -> None:
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
    api_key = os.environ["MAILGUN_API_KEY"]
    expected = hmac.new(
        api_key.encode(), f"{timestamp}{token}".encode(), hashlib.sha256
    ).hexdigest()
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
    """Receive inbound email from Mailgun webhook."""
    if not _verify_mailgun_signature(token, timestamp, signature):
        logger.warning("Invalid Mailgun signature from %s", sender)
        raise HTTPException(status_code=403, detail="Invalid signature")

    logger.info("Email from %s, subject: %s", sender, subject)

    text = _strip_reply_quotes(body_plain)
    if not text:
        logger.info("Empty email body, skipping")
        return {"status": "skipped"}

    chat_id = _email_chat_id(sender)
    reply = await _processor.process(chat_id, text)

    reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
    await _send_reply(sender, reply_subject, reply)

    return {"status": "ok"}
