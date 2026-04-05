"""Telegram bot setup.

Creates a python-telegram-bot Application wired to a Processor instance.
The processor is injected at creation time — the bot doesn't know or care
which processor implementation it's using.
"""

import logging

from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes

from app.processor import Processor

logger = logging.getLogger(__name__)


def create_app(token: str, processor: Processor) -> Application:
    """Build a Telegram Application that routes text messages to the given processor."""

    async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message or not update.message.text:
            return
        user = update.message.from_user
        logger.info("Message from %s (id=%s): %s", user.first_name, user.id, update.message.text)
        reply = await processor.process(update.message.chat_id, update.message.text)
        logger.info("Reply to %s: %s", user.first_name, reply[:100])
        await update.message.reply_text(reply)

    app = Application.builder().token(token).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    return app
