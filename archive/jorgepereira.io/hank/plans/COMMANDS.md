# Slash Commands: CLI-style commands for Hank

Send `/command args` to Hank (via Telegram or email) and it executes a registered command — no LLM involved. Think of it as a lightweight CLI built into the bot.

## How it works

```
User sends "/echo hello world"
  → Command router parses: command="echo", args="hello world"
  → Looks up "echo" in command registry
  → Calls echo handler with args
  → Returns result directly (no Claude, no intent detection)
```

## Why this is separate from HankProcessor

Slash commands bypass the HankProcessor entirely:
- No intent detection (no LLM call, instant response)
- Deterministic — same input always gives same output
- Cheap — no API costs
- Good for utility functions: listing memories, checking status, etc.

Regular messages still go through HankProcessor for chat/remember intent detection.

## Architecture

### Command registry

A simple dict mapping command names to handler functions:

```python
COMMANDS = {
    "echo": echo_handler,
    "help": help_handler,
    # future: "memories", "forget", etc.
}
```

Each handler is an async function:
```python
async def echo_handler(args: str, chat_id: int) -> str:
    return args or "Nothing to echo."
```

### Command router

A module that:
1. Parses the message: splits `/command args` into command name + args string
2. Looks up the command in the registry
3. Calls the handler and returns the result
4. If unknown command: returns a help message listing available commands

```python
async def handle_command(text: str, chat_id: int) -> str | None:
    """Parse and execute a slash command. Returns None if not a command."""
    if not text.startswith("/"):
        return None
    parts = text[1:].split(maxsplit=1)
    command = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""
    handler = COMMANDS.get(command)
    if handler:
        return await handler(args, chat_id)
    return f"Unknown command: /{command}\n\nAvailable commands:\n" + ...
```

### Integration with channels

**Telegram (`app/bot.py`):**
Currently, the message handler filters out commands (`~filters.COMMAND`). We need to add a separate handler for commands that calls the command router instead of the processor.

**Email (`app/email_handler.py`):**
If the first line of the email body (after stripping reply quotes) starts with `/`, route through the command router instead of the processor. This way you can email Hank with a body like:

```
/memories wifi
```

And get back a list of matching memories. The rest of the email body after the first line is ignored for command parsing — only the first line matters.

Example email:
```
To: hank@hank.jorgepereira.io
Subject: anything

/echo hello world
```

Reply from Hank: `hello world`

### File structure

```
app/
├── commands/
│   ├── __init__.py    # Command registry + router
│   ├── echo.py        # /echo command
│   └── help.py        # /help command (auto-generated from registry)
```

## Scope — initial commands

### /echo `<text>`
Echoes back the text. For testing.

```
/echo hello world
→ hello world
```

### /help
Lists all available commands with descriptions. Auto-generated from the registry.

```
/help
→ Available commands:
  /echo <text> — Echo back the text
  /help — Show this help message
```

## Out of scope (future commands)

- `/memories` — list recent saved memories
- `/memories <search>` — search memories
- `/forget <id>` — delete a memory
- `/status` — bot status (uptime, processor, etc.)
