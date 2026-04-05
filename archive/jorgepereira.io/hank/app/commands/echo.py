"""Echo command — echoes back the text. For testing."""


async def echo_handler(args: str, chat_id: int) -> str:
    """Echo back whatever the user typed after /echo."""
    return args or "Nothing to echo."
