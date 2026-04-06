"""Telegram bot setup.

Creates a python-telegram-bot Application wired to a Processor instance.
Slash commands (e.g. /echo, /help, /memory) are handled by the command router
and bypass the processor entirely — no LLM, instant response.
Regular text messages go through the processor (HankProcessor by default).
"""

import logging
import os
from datetime import datetime, timezone

from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters, ContextTypes

from app.actions.remember import MemoryMetadata, MEMORIES_DIR, _slugify
from app.commands import handle_command, COMMANDS
from app.identity import Identity, IdentityRegistry
from app.message import render_response
from app.processor import Processor

logger = logging.getLogger(__name__)


def create_app(token: str, processor: Processor, registry: IdentityRegistry | None = None) -> Application:
    """Build a Telegram Application with command handlers and a message handler.

    Args:
        token: Telegram bot token from @BotFather.
        processor: The processor instance to handle regular messages.
        registry: Identity registry for resolving users. If None, all users allowed.
    """

    def _resolve_identity(user) -> Identity | None:
        """Resolve a Telegram user to an Identity. Returns None if not found/no registry."""
        if not registry:
            return None
        identity = registry.resolve_telegram(user.id)
        if not identity:
            logger.warning("Blocked message from %s (id=%s) — no identity found", user.first_name, user.id)
        return identity

    def _check_allowed(user) -> bool:
        """Check if a user has a registered identity (or if no registry, allow all)."""
        if not registry:
            return True
        return registry.resolve_telegram(user.id) is not None

    async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle regular text messages — routed through the processor."""
        if not update.message or not update.message.text:
            return
        if not _check_allowed(update.message.from_user):
            return

        user = update.message.from_user
        identity = _resolve_identity(user)
        logger.info("Message from %s (id=%s, identity=%s): %s", user.first_name, user.id, identity.id if identity else "none", update.message.text)

        # Build metadata for potential memory saving
        meta = MemoryMetadata(
            medium="telegram",
            source=f"{user.first_name} (id={user.id})",
        )
        response = await processor.process(update.message.chat_id, update.message.text, metadata=meta, identity=identity)

        # Handle RecallResult — may need to send an image
        from app.actions.recall import RecallResult
        if isinstance(response, RecallResult):
            logger.info("Recall result: action=%s, matches=%s", response.action, response.matches)
            if response.image_file:
                # Send the image along with the reply text
                await update.message.reply_photo(
                    photo=open(response.image_file, "rb"),
                    caption=response.reply[:1024],  # Telegram caption limit
                )
            else:
                await update.message.reply_text(response.reply)
        else:
            reply, _ = render_response(response, "telegram")
            logger.info("Reply to %s: %s", user.first_name, reply[:100])
            await update.message.reply_text(reply)

    async def handle_slash_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle slash commands — routed through the command router, no LLM."""
        if not update.message or not update.message.text:
            return
        if not _check_allowed(update.message.from_user):
            return

        user = update.message.from_user
        identity = _resolve_identity(user)
        logger.info("Command from %s (id=%s): %s", user.first_name, user.id, update.message.text)

        memories_dir = identity.memories_dir if identity else None
        response = await handle_command(update.message.text, update.message.chat_id, channel="telegram", memories_dir=memories_dir)
        reply, _ = render_response(response, "telegram")
        logger.info("Command reply to %s: %s", user.first_name, reply[:100])
        await update.message.reply_text(reply)

    async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle incoming photos — download and save as a memory.

        Photos are always treated as "remember" intent. The image is saved
        as a .png file, and a .md file is created with metadata. A post-processor
        then sends the image to Claude Vision for description.
        """
        if not update.message or not update.message.photo:
            return
        if not _check_allowed(update.message.from_user):
            return

        user = update.message.from_user
        identity = _resolve_identity(user)
        caption = update.message.caption or ""
        logger.info("Photo from %s (id=%s, identity=%s), caption: %s", user.first_name, user.id, identity.id if identity else "none", caption[:100])

        # Telegram provides multiple sizes — grab the largest
        photo = update.message.photo[-1]
        file = await context.bot.get_file(photo.file_id)

        # Save the image to the identity-scoped memories directory
        target_memories = identity.memories_dir if identity else MEMORIES_DIR
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%Y-%m-%d")
        time_str = now.strftime("%Y-%m-%dT%H-%M-%S")
        slug = _slugify(caption[:50]) if caption else "photo"

        day_dir = os.path.join(target_memories, date_str)
        os.makedirs(day_dir, exist_ok=True)

        # Download to a temp path first to detect the actual format
        temp_path = os.path.join(day_dir, f"{time_str}_{slug}.tmp")
        await file.download_to_drive(temp_path)

        # Detect actual image format from magic bytes
        with open(temp_path, "rb") as f:
            header = f.read(12)
        if header[:3] == b'\xff\xd8\xff':
            ext = ".jpg"
        elif header[:8] == b'\x89PNG\r\n\x1a\n':
            ext = ".png"
        elif header[:4] == b'GIF8':
            ext = ".gif"
        elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':
            ext = ".webp"
        else:
            ext = ".jpg"  # safe default for Telegram

        image_filename = f"{time_str}_{slug}{ext}"
        image_path = os.path.join(day_dir, image_filename)
        os.rename(temp_path, image_path)
        logger.info("Downloaded photo to %s", image_path)

        # Build the markdown content — caption or a placeholder
        content = f"# {caption or 'Photo'}\n\n![{caption or 'photo'}]({image_filename})"

        meta = MemoryMetadata(
            medium="telegram",
            source=f"{user.first_name} (id={user.id})",
            content_type="image",
            image_path=image_path,
        )

        from app.actions.remember import save_memory
        response = await save_memory(content, metadata=meta, memories_dir=target_memories)
        reply, _ = render_response(response, "telegram")
        logger.info("Photo reply to %s: %s", user.first_name, reply[:100])
        await update.message.reply_text(reply)

    app = Application.builder().token(token).build()

    # Register a CommandHandler for each registered slash command.
    for cmd_name in COMMANDS:
        app.add_handler(CommandHandler(cmd_name, handle_slash_command))

    # Catch-all for unknown commands
    app.add_handler(MessageHandler(filters.COMMAND, handle_slash_command))

    # Photos — always saved as memories
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))

    # Regular text messages go through the processor
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    return app
