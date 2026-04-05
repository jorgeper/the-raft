# Hank Processor: Unified smart processor with intent detection

Replace the current separate processors (ClaudeProcessor, RememberProcessor) with a single smart HankProcessor that handles all intents — chat, remember, and future capabilities — across both Telegram and email.

## The problem

Right now, routing is done at the channel level:
- `hank@` → ClaudeProcessor (chat)
- `remember@` → RememberProcessor (save)
- Telegram → ClaudeProcessor (chat only, can't remember)

This means Telegram can't trigger remember, and emailing `hank@` with "remember this" doesn't save anything. The routing logic is in the wrong place.

## The solution

One smart processor — `HankProcessor` — that:
1. Receives a message from any channel (Telegram or email)
2. Figures out the **intent** (chat, remember, etc.)
3. Routes to the right **action module** (chat via Claude, save to disk, etc.)
4. Returns a reply

```
Any channel → HankProcessor → detect intent → execute action → reply
```

## How intent detection works

### Email to `remember@hank.jorgepereira.io` (shortcut)

No LLM needed. The email handler tags the message with `intent=remember` before passing it to HankProcessor. The processor skips intent detection and goes straight to the save action.

### Email to `hank@hank.jorgepereira.io` or Telegram message

The processor sends the message to Claude with a system prompt that asks it to classify the intent:

- **remember** — user wants to save something ("remember this", "save this link", forwarded content with "keep this")
- **chat** — normal conversation (everything else)

Claude returns a structured response: the intent classification plus the reply text (for chat) or the content to save (for remember).

### Intent classification prompt

Something like:
```
Classify the user's intent as one of: "remember" or "chat".
- "remember": the user wants you to save/remember something for later
- "chat": normal conversation

If "remember": extract the content to save and respond with a confirmation.
If "chat": respond normally as Hank.

Respond in JSON: {"intent": "remember"|"chat", "reply": "...", "save_content": "..."}
```

## Architecture

```
HankProcessor
├── _detect_intent(text)        → "chat" | "remember" (calls Claude)
├── _handle_chat(chat_id, text) → reply string (calls Claude for conversation)
├── _handle_remember(text)      → "Got it, I'll remember that." (saves to disk)
```

The remember module is the same file-saving logic from RememberProcessor — just extracted into a shared module that both HankProcessor and the `remember@` shortcut can use.

### File structure

```
app/
├── processor.py                # Processor ABC (unchanged)
├── processors/
│   ├── hank.py                 # HankProcessor — intent detection + routing
│   └── helloworld.py           # HelloWorldProcessor (unchanged, for testing)
├── actions/
│   ├── chat.py                 # Chat action — calls Claude API with conversation history
│   └── remember.py             # Remember action — saves content as markdown files
```

- `processors/hank.py` — the orchestrator. Detects intent, delegates to actions.
- `processors/claude.py` — removed. Chat logic moves to `actions/chat.py`.
- `processors/remember.py` — removed. Save logic moves to `actions/remember.py`.
- `actions/` — stateless action modules. Each does one thing. HankProcessor calls them.

## Email handler changes

The email handler no longer picks processors. It always sends to HankProcessor, but tags the message with metadata:

- `remember@` emails: pass `intent="remember"` so HankProcessor skips detection
- `hank@` emails: pass `intent=None` so HankProcessor detects it via Claude

This could be done by adding an optional `intent` parameter to `process()`, or by prefixing the text with a marker.

## What stays the same

- Storage format: markdown files in `data/memories/YYYY-MM-DD/` (unchanged)
- Docker volume for persistence (unchanged)
- Telegram bot setup (unchanged, just uses HankProcessor now)
- Email handler endpoints (unchanged)
- HelloWorldProcessor (unchanged, still useful for testing)

## Scope

- Refactor into HankProcessor with intent detection
- Chat action (existing Claude conversation logic)
- Remember action (existing file-saving logic)
- Works across both Telegram and email
- `remember@` shortcut still works (skips intent detection)

## Out of scope (future intents)

- **recall** — "what was that wifi password?" (search saved memories)
- **summarize** — "summarize what I saved this week"
- **forget** — "delete that memory about X"
- These would be new action modules plugged into the same intent detection system
