# Voice Messages: Process audio from Telegram

Send Hank a voice message on Telegram and it gets transcribed and processed just like a text message — chat, remember, recall, whatever the intent is.

## How it works

```
User sends voice message on Telegram
  → bot.py downloads the audio file (.oga format)
  → Transcribe to text (Whisper API or similar)
  → Feed the transcript into the normal message flow (HankProcessor)
  → Intent detection, routing, response — same as text
  → Reply with text (and optionally prefix with "🎙 I heard: <transcript>")
```

The key insight: voice messages are just text messages with an extra step (transcription). Once transcribed, they go through the exact same flow — intent resolver, actions, everything.

## Transcription options

### Option 1: OpenAI Whisper API
- Best accuracy, supports many languages
- $0.006/minute — very cheap
- Requires an OpenAI API key (`OPENAI_API_KEY`)
- Simple HTTP API: upload audio file, get text back

### Option 2: Local Whisper (whisper.cpp or faster-whisper)
- Free, no API key needed
- Requires a model file (~150MB for small, ~1.5GB for medium)
- Adds complexity to the Docker image
- Slower on a small VPS

### Option 3: Anthropic (if/when they support audio)
- Not currently available for audio transcription
- Would simplify the stack (one API for everything)

**Recommendation:** OpenAI Whisper API. Cheap, accurate, simple. One HTTP call.

## Telegram voice message format

Telegram sends voice messages as `.oga` files (Ogg Vorbis). The Whisper API accepts `.ogg`, `.mp3`, `.wav`, `.m4a`, and others — `.oga` works directly since it's Ogg container format.

## Implementation

### New handler in bot.py

Add a `handle_voice` handler alongside `handle_message` and `handle_photo`:

```python
async def handle_voice(update, context):
    voice = update.message.voice
    file = await context.bot.get_file(voice.file_id)
    # Download to temp file
    # Transcribe via Whisper API
    # Feed transcript into processor.process(chat_id, transcript, metadata)
```

### Transcription module (`app/transcribe.py`)

```python
async def transcribe(audio_path: str) -> str:
    """Transcribe an audio file to text using OpenAI Whisper API."""
```

### Flow after transcription

The transcript is just text — goes through the normal flow:
- "Remember this: the wifi password is trout42" → remember intent
- "What was that receipt?" → recall intent
- "Hey Hank, how's it going?" → chat intent

### Memory for voice messages

If the intent is "remember", save both:
- The transcript as the markdown body
- The original audio file alongside (like we do with images)
- Frontmatter: `type: voice`, `audio: <filename>.oga`

### What the user sees

After sending a voice message, Hank replies with the normal response — just as if the user had typed the transcript. Optionally prefix with the transcript so the user can verify:

```
🎙 "Remember the wifi password is trout42"

Got it, I'll remember that.
```

## Environment

```
OPENAI_API_KEY=<your-openai-api-key>
```

## Scope

- Voice message handler in bot.py
- Transcription via OpenAI Whisper API
- Transcript fed into normal HankProcessor flow (all intents work)
- Save audio file alongside markdown for voice memories
- Show transcript in reply so user can verify

## Out of scope

- Voice replies (text-to-speech)
- Video messages
- Audio from email (no standard format)
- Local transcription (Whisper model in container)
- Speaker identification
