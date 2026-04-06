"""Help command — lists all available commands."""


async def help_handler(args: str, chat_id: int, channel: str, **kwargs) -> str:
    """List all available slash commands with descriptions."""
    from app.commands import COMMANDS

    lines = ["Available commands:", ""]
    for _, (_, desc) in COMMANDS.items():
        lines.append(f"  {desc}")
    return "\n".join(lines)
