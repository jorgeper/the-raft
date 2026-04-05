# Memory Metadata and Post-Processing

Add structured metadata (frontmatter) to every saved memory, and a post-processing pipeline that enriches memories after saving.

## Frontmatter

Every memory markdown file gets YAML frontmatter at the top — same format as Obsidian. This makes memories machine-readable for future indexing and recall.

```markdown
---
date: 2026-04-05
time: "22:06:47"
medium: email
type: url
source: jorgeper@gmail.com
tags: []
---

# WiFi password at the cabin

The wifi password at the cabin is trout42
```

### Fields

| Field    | Description                                      | Values                           |
|----------|--------------------------------------------------|----------------------------------|
| `date`   | Date the memory was saved (UTC)                  | `2026-04-05`                     |
| `time`   | Time the memory was saved (UTC)                  | `"22:06:47"`                     |
| `medium` | Which channel it came from                       | `telegram`, `email`, `email-remember` |
| `type`   | What kind of content it is                       | `note`, `url`, `image` (future)  |
| `source` | Who sent it (email address or Telegram user info)| `jorgeper@gmail.com`, `Jorge (id=123)` |
| `tags`   | Auto-generated or manual tags (empty for now)    | `[]`                             |

### Type detection

Simple heuristics to classify the content type:

- **url** — message is a bare URL or contains a URL as the primary content
- **note** — everything else (plain text)
- **image** — future, when we support attachments

## Post-processing pipeline

After saving a memory, run post-processors based on the content type. For now this runs synchronously (before replying to the user). Later we can make it async so the user gets a fast reply while processing happens in the background.

### Architecture

```
save_memory(content, metadata)
  → write file with frontmatter
  → run post-processors for this type
  → return confirmation
```

```python
# Registry of post-processors by content type
POST_PROCESSORS = {
    "url": [fetch_url_content],
    "note": [],
    "image": [],  # future
}
```

Each post-processor is a function that takes the filepath and metadata, and can modify the file (e.g. append fetched content).

### URL post-processor (this phase)

When a memory is of type `url`:
1. Extract the URL from the content
2. Fetch the page (HTTP GET)
3. Extract the page title from `<title>` tag
4. Append the title to the memory file as additional context

Before:
```markdown
---
date: 2026-04-05
time: "22:24:00"
medium: telegram
type: url
source: Jorge (id=123)
tags: []
---

# https://kama-asa.co.jp/en-us/cart

https://kama-asa.co.jp/en-us/cart
```

After post-processing:
```markdown
---
date: 2026-04-05
time: "22:24:00"
medium: telegram
type: url
source: Jorge (id=123)
tags: []
title: "Kama-Asa — Shopping Cart"
---

# https://kama-asa.co.jp/en-us/cart

https://kama-asa.co.jp/en-us/cart
```

The fetched title gets added to the frontmatter — useful for future search/indexing.

### File structure

```
app/
├── actions/
│   ├── remember.py          # Updated: writes frontmatter, runs post-processors
│   └── post_processors/
│       ├── __init__.py       # Post-processor registry
│       └── url.py            # Fetch URL title
```

## Changes to save flow

### Metadata passed through the chain

The `save_memory` function needs metadata from the channel layer:

```python
@dataclass
class MemoryMetadata:
    medium: str        # "telegram", "email", "email-remember"
    source: str        # email address or Telegram user info
    content_type: str  # "note", "url" (auto-detected if not set)
```

The channel layers (bot.py, email_handler.py) create this and pass it down:
- `email_handler.py` → `MemoryMetadata(medium="email", source=sender)`
- `bot.py` → `MemoryMetadata(medium="telegram", source="Jorge (id=123)")`

HankProcessor passes it to `save_memory()`, which writes the frontmatter and runs post-processors.

### Content type auto-detection

Reuse the bare URL heuristic from `intent.py`:
- If the content is a bare URL → `type: url`
- Otherwise → `type: note`

## Scope

- YAML frontmatter on all new memories (date, time, medium, type, source, tags)
- `MemoryMetadata` dataclass passed through the chain
- Content type auto-detection (url vs note)
- Post-processor registry by type
- URL post-processor: fetch page title, add to frontmatter
- Synchronous post-processing (runs before replying)

## Out of scope (future)

- Async post-processing (reply first, process in background)
- Image post-processing (Claude vision for description)
- Full page content extraction (readability/article extraction)
- Auto-tagging via LLM
- Embedding generation for vector search
- Using metadata for search/recall
