# Intent Resolver: Centralized intent detection with cheap heuristics first

## The problem

Intent detection is scattered across multiple places:
- `email_handler.py` checks the recipient address (`remember@`)
- `hank.py` calls Claude for intent classification
- Nobody checks for obvious patterns like bare URLs

And every ambiguous message hits Claude for classification — even when a simple regex could tell us the intent for free.

## The solution

One module — `app/intent.py` — that decides the intent for any message. It runs a chain of checks from cheapest to most expensive, and stops as soon as one matches.

```
Message → intent resolver
  1. Explicit override? (remember@ shortcut)     → "remember"  [free]
  2. Bare URL?                                    → "remember"  [free]
  3. Starts with known keyword? ("remember this") → "remember"  [free]
  4. None of the above? → Claude classification   → "remember" or "chat"  [costs tokens]
```

### The chain

Each check is a simple function. The resolver runs them in order and returns the first non-None result.

```python
async def resolve_intent(text: str, explicit_intent: str | None = None) -> str:
    """Determine the intent for a message.

    Runs cheap heuristics first, falls back to LLM only when needed.
    Returns: "remember" or "chat"
    """
    # 1. Explicit override (e.g. remember@ shortcut)
    if explicit_intent:
        return explicit_intent

    # 2. Heuristics (free, no LLM)
    heuristic = _check_heuristics(text)
    if heuristic:
        return heuristic

    # 3. LLM classification (expensive, last resort)
    return await _classify_with_llm(text)
```

### Heuristics (free)

These are simple pattern checks — no LLM, instant, zero cost.

**Bare URL:** If the entire message (stripped) is just a URL, it's a "remember". People don't send bare links to chat about — they want to save them.

```python
def _is_bare_url(text: str) -> bool:
    """Check if the message is just a URL with no other text."""
    stripped = text.strip()
    return bool(re.match(r'^https?://\S+$', stripped))
```

**Keyword prefix:** If the message starts with an explicit instruction like "remember", "save", "keep this".

```python
REMEMBER_KEYWORDS = ["remember this", "remember:", "save this", "save:", "keep this"]

def _starts_with_remember_keyword(text: str) -> bool:
    lower = text.strip().lower()
    return any(lower.startswith(kw) for kw in REMEMBER_KEYWORDS)
```

**Future heuristics** (not now, but easy to add):
- Message is just an image (when we support attachments)
- Message is a forwarded message with no user commentary
- Message contains only a phone number, address, or other structured data

### LLM classification (expensive, last resort)

Same as the current `_detect_intent` in `hank.py`, but moved into `intent.py`. Only called when heuristics can't determine the intent. Uses the first 500 chars (already implemented).

## What changes

### New file: `app/intent.py`

Contains:
- `resolve_intent(text, explicit_intent)` — the main entry point
- `_check_heuristics(text)` — runs all heuristic checks
- `_is_bare_url(text)` — bare URL check
- `_starts_with_remember_keyword(text)` — keyword prefix check
- `_classify_with_llm(text)` — Claude classification (moved from hank.py)

### Changes to `app/processors/hank.py`

Remove `_detect_intent` and the intent system prompt. Replace with a call to `resolve_intent()`.

Before:
```python
if intent is None:
    detected = await self._detect_intent(text)
    intent = detected["intent"]
```

After:
```python
from app.intent import resolve_intent
intent = await resolve_intent(text, explicit_intent=intent)
```

### Changes to `app/email_handler.py`

The `remember@` shortcut still passes `intent="remember"` to the processor, which passes it to the resolver as `explicit_intent`. No change needed.

## Token savings

| Message type | Before (tokens) | After (tokens) |
|---|---|---|
| `remember@` email | 0 (already free) | 0 |
| Bare URL | ~500 (Claude call) | 0 (heuristic) |
| "Remember this: ..." | ~500 (Claude call) | 0 (heuristic) |
| Ambiguous message | ~500 (Claude call) | ~500 (Claude call) |

Most "remember" messages will be caught by heuristics. Claude is only called for genuinely ambiguous messages.

## Scope

- `app/intent.py` with resolver chain
- Bare URL heuristic
- Keyword prefix heuristic
- Move LLM classification from hank.py to intent.py
- HankProcessor calls resolver instead of doing its own detection

## Out of scope

- Image/attachment heuristics
- Forwarded message detection
- Learning from user corrections ("no, I meant chat")
