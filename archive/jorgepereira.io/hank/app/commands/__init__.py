"""Slash command registry and router.

Commands are registered as async handler functions. The router parses
incoming messages, looks up the command, and calls the handler.

To add a new command:
1. Create a file in app/commands/ with an async handler function
2. Register it in COMMANDS below with a name and description
"""

import logging

from app.commands.echo import echo_handler
from app.commands.help import help_handler
from app.commands.memory import memory_handler
from app.message import Message

logger = logging.getLogger(__name__)

# Registry: command name → (handler, description)
# The description is used by /help to auto-generate the command list.
#
# Handler signature: async def handler(args: str, chat_id: int, channel: str) -> str | Message
# - args: everything after the command name
# - chat_id: the conversation ID
# - channel: "telegram" or "email" (for channel-aware rendering)
COMMANDS: dict[str, tuple] = {
    "echo": (echo_handler, "/echo <text> — Echo back the text"),
    "help": (help_handler, "/help — Show available commands"),
    "memory": (memory_handler, "/memory [today|yesterday|YYYY-MM-DD|last|wipe] — List, inspect, or wipe memories"),
}


def is_command(text: str) -> bool:
    """Check if a message is a slash command."""
    return text.strip().startswith("/")


async def handle_command(text: str, chat_id: int, channel: str = "telegram") -> str | Message:
    """Parse and execute a slash command.

    Args:
        text: The full message text starting with /
        chat_id: The chat/conversation ID
        channel: "telegram" or "email" — passed to the handler for rendering

    Returns:
        The command's response — either a plain string or a Message object.
    """
    # Parse: "/echo hello world" → command="echo", args="hello world"
    stripped = text.strip()
    body = stripped[1:]  # remove leading /
    # Handle Telegram-style commands like /echo@hank_bot by stripping the @mention
    parts = body.split(maxsplit=1)
    command = parts[0].lower().split("@")[0]
    args = parts[1] if len(parts) > 1 else ""

    logger.info("Command: /%s, args: %s, channel: %s", command, args[:100], channel)

    handler_entry = COMMANDS.get(command)
    if handler_entry:
        handler, _ = handler_entry
        return await handler(args, chat_id, channel)

    # Unknown command — list available ones
    available = "\n".join(f"  {desc}" for _, (_, desc) in COMMANDS.items())
    return f"Unknown command: /{command}\n\nAvailable commands:\n{available}"
