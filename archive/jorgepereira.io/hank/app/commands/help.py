"""Help command — lists all available commands."""


async def help_handler(args: str, chat_id: int) -> str:
    """List all available slash commands with descriptions."""
    # Import here to avoid circular import (COMMANDS imports help_handler)
    from app.commands import COMMANDS

    lines = ["Available commands:", ""]
    for _, (_, desc) in COMMANDS.items():
        lines.append(f"  {desc}")
    return "\n".join(lines)
