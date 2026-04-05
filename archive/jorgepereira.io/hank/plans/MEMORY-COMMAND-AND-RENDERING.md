# /memory Command and Channel-Aware Rendering

Two features in one: a `/memory` command to list saved memories, and a rendering system so responses look good on both Telegram and email.

## The problem

1. No way to browse saved memories from Telegram or email — you have to SSH into the VPS and `ls data/memories/`
2. All responses are plain text strings. Telegram and email have different formatting capabilities and screen sizes, but we treat them the same.

## /memory command

### Usage

```
/memory today          — list today's memories
/memory yesterday      — list yesterday's memories
/memory 2026-04-05     — list memories from a specific date
/memory                — list today's memories (default)
```

### What it returns

A table of saved memories for the requested date: time, and a preview of the content.

**On Telegram** (concise, fits small screen):
```
📋 Memories for 2026-04-05

09:15 — wifi password at the cabin
14:22 — youtube.com/watch?v=dQw4w9WgXcQ
21:33 — meeting notes from standup

3 memories
```

**On email** (more detail, wider layout):
```
Memories for 2026-04-05

| Time  | Subject              | Preview                                    |
|-------|----------------------|--------------------------------------------|
| 09:15 | WiFi Password        | The wifi password at the cabin is trout42   |
| 14:22 | YouTube Link         | youtube.com/watch?v=dQw4w9WgXcQ             |
| 21:33 | Meeting Notes        | Discussed roadmap, assigned tickets to...   |

3 memories saved on this date.
```

### Implementation

- Parse the `args` string: "today", "yesterday", or a date string
- Read the files from `data/memories/YYYY-MM-DD/`
- For each file: extract the timestamp from the filename, read the first line (title) and a preview of the body
- Return a `Message` object (see below) that renders differently per channel

## Channel-aware rendering

### The Message type

Instead of returning a plain `str` from commands and processors, we return a `Message` object that knows how to render itself for different channels.

```python
class Message:
    """A response that renders differently depending on the destination channel."""

    def render(self, channel: str) -> str:
        """Render this message for the given channel.

        Args:
            channel: "telegram" or "email"
        """
```

For simple text responses (like `/echo`), a plain string still works — we auto-wrap it. For richer responses (like `/memory`), the command returns a `Message` subclass that formats differently.

### Message types

**TextMessage** — plain text, same on all channels. Wraps a string.
```python
TextMessage("Got it, I'll remember that.")
```

**TableMessage** — tabular data, renders as compact list on Telegram, full table on email.
```python
TableMessage(
    title="Memories for 2026-04-05",
    headers=["Time", "Subject", "Preview"],
    rows=[
        ["09:15", "WiFi Password", "The wifi password at the cabin is trout42"],
        ...
    ],
    footer="3 memories saved on this date.",
)
```

**Telegram rendering:**
```
📋 Memories for 2026-04-05

09:15 — WiFi Password
14:22 — YouTube Link
21:33 — Meeting Notes

3 memories saved on this date.
```
(Compact — just time + subject, skip preview since Telegram is narrow)

**Email rendering:**
```
Memories for 2026-04-05

| Time  | Subject              | Preview                                    |
|-------|----------------------|--------------------------------------------|
| 09:15 | WiFi Password        | The wifi password at the cabin is trout42   |
| 14:22 | YouTube Link         | youtube.com/watch?v=dQw4w9WgXcQ             |
| 21:33 | Meeting Notes        | Discussed roadmap, assigned tickets to...   |

3 memories saved on this date.
```

### Where rendering happens

The channel layer (bot.py for Telegram, email_handler.py for email) calls `message.render("telegram")` or `message.render("email")` before sending.

### How it flows through the system

1. Command handler returns a `Message` object (or a plain `str` for simple responses)
2. The channel layer (bot.py / email_handler.py) checks: is it a `Message` or a `str`?
   - If `str`: send as-is (backwards compatible)
   - If `Message`: call `.render(channel)` to get the formatted string, then send
3. Processors (HankProcessor) can also return `Message` objects in the future

### File structure

```
app/
├── message.py              # Message, TextMessage, TableMessage classes
├── commands/
│   ├── __init__.py         # registry + router (updated to pass channel)
│   ├── echo.py
│   ├── help.py
│   └── memory.py           # /memory command (new)
```

### Changes to command interface

Command handlers gain a `channel` parameter:

```python
async def memory_handler(args: str, chat_id: int, channel: str) -> str | Message:
```

The router passes the channel through. Existing commands (echo, help) can ignore it — they return plain strings which work everywhere.

## Scope

- `Message`, `TextMessage`, `TableMessage` classes
- Channel-aware rendering in bot.py and email_handler.py
- `/memory` command with today/yesterday/date support
- Update command handler signature to include channel

## Out of scope

- `/memory search <query>` — search across all dates
- Rich formatting (HTML, markdown) in Telegram — plain text for now
- Attachments or images in responses
