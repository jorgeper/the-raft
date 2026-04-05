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


def create_app(token: str, processor: Processor, allowed_users: set[int] | None = None) -> Application:
    """Build a Telegram Application that routes text messages to the given processor.

    Args:
        token: Telegram bot token from @BotFather.
        processor: The processor instance to handle messages (e.g. ClaudeProcessor).
        allowed_users: Set of Telegram user IDs allowed to use the bot.
                       If None, all users are allowed.
    """

    async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle an incoming text message from Telegram.

        This is called for every non-command text message. It:
        1. Checks if the sender is in the allowlist (if configured)
        2. Passes the message text to the processor
        3. Sends the processor's reply back to the user
        """
        if not update.message or not update.message.text:
            return

        user = update.message.from_user

        # Check allowlist — silently drop messages from unauthorized users.
        # We log a warning so the bot owner can see blocked attempts.
        if allowed_users and user.id not in allowed_users:
            logger.warning("Blocked message from %s (id=%s)", user.first_name, user.id)
            return

        logger.info("Message from %s (id=%s): %s", user.first_name, user.id, update.message.text)

        # Send the message through the processor and reply with the result.
        # The processor is injected — could be Claude, helloworld, or anything else.
        reply = await processor.process(update.message.chat_id, update.message.text)
        logger.info("Reply to %s: %s", user.first_name, reply[:100])
        await update.message.reply_text(reply)

    # Build the Telegram Application and register our message handler.
    # filters.TEXT matches text messages, ~filters.COMMAND excludes /commands.
    app = Application.builder().token(token).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    return app
