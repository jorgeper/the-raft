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
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Form, HTTPException, Request, UploadFile

from app.actions.remember import MemoryMetadata, MEMORIES_DIR, _slugify
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


async def _send_reply(
    to: str,
    subject: str,
    body: str,
    from_addr: str | None = None,
    html: bool = False,
    attachment_path: str | None = None,
) -> None:
    """Send a reply email via the Mailgun API.

    Args:
        html: If True, send body as HTML instead of plain text.
        attachment_path: Path to a file to attach (e.g. an image).
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

    files = None
    if attachment_path and os.path.exists(attachment_path):
        filename = os.path.basename(attachment_path)
        files = {"attachment": (filename, open(attachment_path, "rb"))}
        logger.info("Attaching file: %s", attachment_path)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.mailgun.net/v3/{domain}/messages",
            auth=("api", api_key),
            data=data,
            files=files,
        )
        resp.raise_for_status()
        logger.info("Sent reply email to %s (html=%s, attachment=%s)", to, html, attachment_path is not None)


def _verify_mailgun_signature(token: str, timestamp: str, signature: str) -> bool:
    """Verify that an inbound webhook actually came from Mailgun."""
    signing_key = os.environ.get("MAILGUN_WEBHOOK_SIGNING_KEY", os.environ.get("MAILGUN_API_KEY", ""))
    expected = hmac.HMAC(
        signing_key.encode(), f"{timestamp}{token}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

_EXT_BY_MAGIC = [
    (b'\xff\xd8\xff', ".jpg"),
    (b'\x89PNG\r\n\x1a\n', ".png"),
    (b'GIF8', ".gif"),
]


def _detect_image_ext(header: bytes) -> str:
    """Detect image extension from magic bytes."""
    for magic, ext in _EXT_BY_MAGIC:
        if header[:len(magic)] == magic:
            return ext
    if header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return ".webp"
    return ".jpg"


async def _save_email_attachment(attachment: UploadFile) -> str | None:
    """Save an image attachment to the memories directory.

    Returns the file path on disk, or None if not an image.
    """
    if attachment.content_type not in _IMAGE_CONTENT_TYPES:
        logger.info("Skipping non-image attachment: %s (%s)", attachment.filename, attachment.content_type)
        return None

    data = await attachment.read()
    if not data:
        return None

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%Y-%m-%dT%H-%M-%S")

    # Use the original filename for the slug, fall back to "photo"
    name = attachment.filename or "photo"
    slug = _slugify(os.path.splitext(name)[0][:50]) or "photo"

    ext = _detect_image_ext(data[:12])

    day_dir = os.path.join(MEMORIES_DIR, date_str)
    os.makedirs(day_dir, exist_ok=True)

    image_filename = f"{time_str}_{slug}{ext}"
    image_path = os.path.join(day_dir, image_filename)
    with open(image_path, "wb") as f:
        f.write(data)

    logger.info("Saved email attachment to %s (%d bytes)", image_path, len(data))
    return image_path


@router.post("/email")
async def handle_email(request: Request):
    """Receive an inbound email from Mailgun.

    Routes to the processor with different intents based on recipient:
    - remember@... → intent="remember" (skip detection, save directly)
    - anything else → intent=None (HankProcessor detects via Claude)

    Mailgun sends multipart/form-data with file uploads for attachments.
    We parse the whole form to extract both fields and attached images.
    """
    form = await request.form()

    sender = form.get("sender", "")
    recipient = form.get("recipient", "")
    subject = form.get("subject", "")
    body_plain = form.get("body-plain", "")
    body_html = form.get("body-html", "")
    token = form.get("token", "")
    timestamp = form.get("timestamp", "")
    signature = form.get("signature", "")

    if not sender or not token or not timestamp or not signature:
        raise HTTPException(status_code=400, detail="Missing required fields")

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

    # Log all form field names and types for debugging attachment detection
    for key in form:
        value = form[key]
        if isinstance(value, UploadFile):
            logger.info("Form field %r: UploadFile(filename=%r, content_type=%r)", key, value.filename, value.content_type)
        else:
            logger.info("Form field %r: str (%d chars)", key, len(str(value)))

    # Check sender allowlist
    allowed_senders_str = os.getenv("ALLOWED_EMAIL_SENDERS", "")
    allowed_senders = {s.strip().lower() for s in allowed_senders_str.split(",") if s.strip()}
    if allowed_senders and sender.lower() not in allowed_senders:
        logger.warning("Blocked email from %s (not in ALLOWED_EMAIL_SENDERS)", sender)
        return {"status": "blocked"}

    # Extract image attachments from the form
    # Mailgun sends attachments as file fields named "attachment-1", "attachment-2", etc.
    image_path = None
    for key in form:
        value = form[key]
        if isinstance(value, UploadFile):
            saved = await _save_email_attachment(value)
            if saved:
                image_path = saved
                break  # use the first image attachment

    # Strip quoted reply text
    text = _strip_reply_quotes(body_plain)
    if not text and not image_path:
        logger.info("Empty email body and no image, skipping")
        return {"status": "skipped"}

    # Determine routing based on recipient address and message content
    local_part = _extract_recipient_local(recipient)
    chat_id = _email_chat_id(sender)

    # If we have an image attachment, save it as a memory (same as Telegram photos)
    if image_path:
        logger.info("Email has image attachment — saving as memory")
        caption = text or subject or "Photo"
        image_filename = os.path.basename(image_path)
        content = f"# {caption}\n\n![{caption}]({image_filename})"
        meta = MemoryMetadata(
            medium="email" if local_part != "remember" else "email-remember",
            source=sender,
            content_type="image",
            image_path=image_path,
        )
        response = await _processor.process(chat_id, content, intent="remember", metadata=meta)
        reply, is_html = render_response(response, "email")
        reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
        from_addr = None
        if local_part == "remember":
            from_addr = f"Hank <remember@{os.environ['MAILGUN_DOMAIN']}>"
        await _send_reply(sender, reply_subject, reply, from_addr=from_addr, html=is_html)
        return {"status": "ok"}

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

        # Handle RecallResult — may need to attach an image
        from app.actions.recall import RecallResult
        if isinstance(response, RecallResult):
            reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
            await _send_reply(
                sender, reply_subject, response.reply,
                attachment_path=response.image_file,
            )
        else:
            reply, is_html = render_response(response, "email")
            reply_subject = subject if subject.startswith("Re:") else f"Re: {subject}"
            await _send_reply(sender, reply_subject, reply, html=is_html)

    return {"status": "ok"}
