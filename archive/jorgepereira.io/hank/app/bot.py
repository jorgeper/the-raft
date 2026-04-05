"""Telegram bot setup.

Creates a python-telegram-bot Application wired to a Processor instance.
Slash commands (e.g. /echo, /help, /memory) are handled by the command router
and bypass the processor entirely — no LLM, instant response.
Regular text messages go through the processor (HankProcessor by default).
"""

import logging

from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters, ContextTypes

from app.commands import handle_command, COMMANDS
from app.message import render_response
from app.processor import Processor

logger = logging.getLogger(__name__)


def create_app(token: str, processor: Processor, allowed_users: set[int] | None = None) -> Application:
    """Build a Telegram Application with command handlers and a message handler.

    Args:
        token: Telegram bot token from @BotFather.
        processor: The processor instance to handle regular messages.
        allowed_users: Set of Telegram user IDs allowed to use the bot.
                       If None, all users are allowed.
    """

    def _check_allowed(user) -> bool:
        """Check if a user is in the allowlist."""
        if allowed_users and user.id not in allowed_users:
            logger.warning("Blocked message from %s (id=%s)", user.first_name, user.id)
            return False
        return True

    async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle regular text messages — routed through the processor."""
        if not update.message or not update.message.text:
            return
        if not _check_allowed(update.message.from_user):
            return

        user = update.message.from_user
        logger.info("Message from %s (id=%s): %s", user.first_name, user.id, update.message.text)

        response = await processor.process(update.message.chat_id, update.message.text)
        reply = render_response(response, "telegram")
        logger.info("Reply to %s: %s", user.first_name, reply[:100])
        await update.message.reply_text(reply)

    async def handle_slash_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle slash commands — routed through the command router, no LLM."""
        if not update.message or not update.message.text:
            return
        if not _check_allowed(update.message.from_user):
            return

        user = update.message.from_user
        logger.info("Command from %s (id=%s): %s", user.first_name, user.id, update.message.text)

        response = await handle_command(update.message.text, update.message.chat_id, channel="telegram")
        reply = render_response(response, "telegram")
        logger.info("Command reply to %s: %s", user.first_name, reply[:100])
        await update.message.reply_text(reply)

    app = Application.builder().token(token).build()

    # Register a CommandHandler for each registered slash command.
    for cmd_name in COMMANDS:
        app.add_handler(CommandHandler(cmd_name, handle_slash_command))

    # Catch-all for unknown commands
    app.add_handler(MessageHandler(filters.COMMAND, handle_slash_command))

    # Regular text messages go through the processor
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    return app
