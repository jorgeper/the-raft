"""Hello-world processor for testing.

Echoes the user's message back. Useful for verifying the bot is running
without needing any API keys.

Set PROCESSOR=helloworld in .env to use this.
"""

from app.processor import Processor


class HelloWorldProcessor(Processor):
    """Echoes back the user's message. No external dependencies."""

    async def process(self, chat_id: int, text: str) -> str:
        return f"Hello! You said: {text}"
