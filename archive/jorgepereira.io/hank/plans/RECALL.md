# Recall: Conversational memory retrieval

Ask Hank to find something from your saved memories. Hank searches, asks clarifying questions if needed, and returns the result — the image, URL, text, whatever was saved.

## User stories

- "Remind me about that restaurant receipt from last week" → Hank finds it, sends the photo
- "What was that Japanese knife website?" → Hank finds the URL, sends it
- "What did I save about wifi passwords?" → Hank finds the note, sends the text
- "Show me the receipts" → Hank finds multiple, asks "Which one? Cafe 34 or Sushi Place?" → you pick → Hank sends it

## How it works

### Intent resolution

Add "recall" as a new intent in `app/intent.py`:

- **Heuristic:** message starts with "remind me", "find", "what was", "show me", "search for"
- **LLM fallback:** Claude classifies as "recall" when the user is asking for something previously saved

The intent chain becomes:
1. Explicit override (remember@ shortcut) → free
2. Bare URL → "remember" (free)
3. Keyword prefix ("remember this") → "remember" (free)
4. Keyword prefix ("remind me", "find", "show me") → "recall" (free)
5. LLM classification → "remember", "recall", or "chat"

### Recall action (`app/actions/recall.py`)

When intent = "recall":

1. **Extract search query** — ask Claude to extract the search intent from the user's message (e.g. "restaurant receipt from last week" → search for type:image, tags containing "restaurant" or "receipt", date range: last 7 days)
2. **Search the index** — find matching memories
3. **Single match** → return the memory content directly (image, URL, text)
4. **Multiple matches** → present options and ask the user to pick
5. **No matches** → "I couldn't find anything matching that. Try different keywords?"

### Conversational refinement

The recall action uses the existing conversation history (ChatAction already maintains per-chat history). When Hank asks "Which one?" and the user replies, the conversation context helps Claude understand the follow-up.

The flow:
1. User: "Show me that receipt"
2. Hank detects intent: recall
3. Hank searches index, finds 3 receipts
4. Hank responds: "I found 3 receipts: 1) Cafe 34 ($285), 2) Sushi Place ($120), 3) Pizza Hut ($45). Which one?"
5. User: "The first one"
6. Intent resolver sees this in context of the conversation → routes to recall
7. Recall action sees conversation history, understands "the first one" = Cafe 34
8. Returns the image

This means the recall action needs access to conversation history, and the intent resolver needs to understand conversational context (i.e. if the previous exchange was a recall disambiguation, a short reply like "the first one" or "Cafe 34" is still a recall, not a chat).

### How to handle this in practice

The simplest approach: when a recall returns multiple results, set a flag in the conversation that we're in "recall mode". The next message from this user in this chat goes through recall again with the disambiguation context, instead of going through fresh intent detection.

This could be a field in the conversation history or a simple in-memory dict:
```python
_active_recalls: dict[int, RecallContext]  # chat_id → pending recall state
```

## Memory Index

### What gets indexed

Every memory file has frontmatter with metadata + a body with content. The index stores a searchable representation of each memory:

```python
@dataclass
class IndexEntry:
    filepath: str          # path to the .md file
    date: str              # "2026-04-05"
    time: str              # "22:06:47"
    medium: str            # "telegram", "email"
    content_type: str      # "note", "url", "image"
    source: str            # email address or Telegram user
    title: str             # first # heading
    preview: str           # first ~200 chars of body
    tags: list[str]        # from frontmatter
    description: str       # AI description (for images)
    ocr_text: str          # visible text in images
    url_title: str         # fetched page title (for URLs)
    image_path: str | None # path to image file
    html_path: str | None  # path to HTML file
```

### Index storage

Keep it simple: a JSON file at `data/memories/index.json`. It's fast to read, easy to inspect, and the dataset is small (hundreds to thousands of entries, not millions).

```json
[
    {
        "filepath": "data/memories/2026-04-05/2026-04-05T22-06-47_wifi-password.md",
        "date": "2026-04-05",
        "title": "WiFi password at the cabin",
        "content_type": "note",
        "preview": "The wifi password at the cabin is trout42",
        ...
    },
    ...
]
```

### Indexing

**When memories are added:** a post-processor runs after every save that adds/updates the entry in the index.

**Manual reindex:** `/index` command rebuilds the entire index by scanning all memory files.

```
/index            — reindex everything
/index today      — reindex today's memories only
/index 2026-04-05 — reindex a specific date
```

### Search: full index in context (no RAG)

Instead of doing retrieval first and sending matches to Claude, we send the **entire index** as context and let Claude find the relevant entries. Inspired by Karpathy's take: skip RAG, just use the context window.

**Why this works:**
- Claude sees everything — can't miss a match due to bad search
- Semantic understanding — "that Japanese knife site" matches the kama-asa URL
- Disambiguation is natural — Claude compares all candidates at once
- Zero search infrastructure — no embeddings, no vector DB, no search algorithm

**Cost estimate (Sonnet at $3/1M input, $15/1M output):**

| Memories | Index tokens | Cost per query |
|----------|-------------|----------------|
| 100 | ~18K | ~$0.06 |
| 500 | ~88K | ~$0.27 |
| 1,000 | ~176K | ~$0.53 |

At ~5-10 memories/day, this approach is viable for 6+ months. Sonnet's 200K context fits ~1,000 memories.

**When to add pre-filtering (future):**
If the index grows beyond context limits, add a pre-filter step before sending to Claude:
- Filter by date range ("last 30 days" by default)
- Filter by content type ("show me images" → only image entries)
- Filter by medium ("what did I email" → only email entries)
This keeps the approach simple while scaling further.

### Recall prompt

Send Claude the full index + user message + conversation history:

```
You are Hank, helping the user find a saved memory.

Here are all saved memories:
<index.json contents>

The user is looking for something. Find the best match(es) from the memories above.

If one clear match: describe it and provide the filename so the system can retrieve it.
If multiple possible matches: list them and ask which one the user means.
If no matches: say you couldn't find it and suggest different keywords.

Respond in JSON:
{"action": "found"|"disambiguate"|"not_found", "matches": [...filenames...], "reply": "..."}
```

## File structure

```
app/
├── actions/
│   ├── recall.py              # Recall action: send index to Claude, return result
│   ├── remember.py            # (existing) adds index post-processor
│   └── post_processors/
│       ├── __init__.py         # register index post-processor
│       ├── url.py              # (existing)
│       ├── image.py            # (existing)
│       └── index.py            # Index post-processor: add entry after save
├── commands/
│   └── index.py               # /index command
├── index.py                   # Index read/write/build operations
├── intent.py                  # (updated) add recall heuristics + LLM intent
```

## Scope

- "recall" intent detection (heuristics + LLM)
- Memory index (JSON file, built from frontmatter + body)
- `/index` command with date parameter
- Index post-processor (auto-index on save)
- Recall action: send full index to Claude, return result or disambiguate
- Conversational disambiguation for multiple matches
- Return images (via Telegram `send_photo`), URLs, or text
- Works on both Telegram and email

## Out of scope (future)

- Pre-filtering by date/type when index exceeds context limits
- Embedding-based semantic search
- "Forget" functionality (delete specific memories via conversation)
- Recall via email with image attachments
