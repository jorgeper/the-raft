# Answer: Questions grounded in memory

Ask Hank a question about your saved memories and get an actual answer — not just the memory itself, but the information extracted from it.

## Recall vs Answer

| Intent | What the user wants | Example | Output |
|--------|-------------------|---------|--------|
| **recall** | Find and return a memory | "Show me that receipt" | The receipt image |
| **answer** | Answer a question using memories as data | "How much was lunch last week?" | "$285.66, from Cafe 34 (here's the receipt)" |

Recall returns memories. Answer returns information derived from memories.

## How it works

### Intent detection

Add "answer" as a new intent. The key difference from "recall": the user is asking a **question** that requires extracting information from memories, not just showing them.

**Heuristics:**
- "how much", "what was the total", "when did", "how many" + memory-related context → "answer"

In practice, the LLM classifier will handle most of these since the distinction between recall and answer is nuanced. Update the classifier:

- "recall" — user wants to see/retrieve a memory ("show me", "find", "pull up")
- "answer" — user wants information from a memory ("how much was", "what was the total", "when did I")
- "remember" — user wants to save something
- "chat" — everything else

### Answer action (`app/actions/answer.py`)

Same approach as recall — send the full index to Claude. But the prompt is different:

1. Send full index + user's question
2. Claude identifies which memory(ies) are relevant
3. Claude reads the memory content (preview, OCR text, description, etc.)
4. Claude answers the question based on the memory data
5. If the memory is an image, Claude might need to see the actual image to answer precisely

### The image problem

For text/URL memories, the index has enough data (preview, content) to answer questions.

For image memories, the index only has:
- The AI description from when the image was saved
- OCR text extracted at save time

This might be enough for many questions ("how much was the total" → OCR text has the receipt items). But for detailed questions, Claude might need to see the actual image.

**Two-step approach:**
1. First pass: Claude answers using index data only (cheap — no image tokens)
2. If Claude says it needs to see the image to answer: second pass with the image attached (expensive but accurate)

The first pass prompt includes a flag:
```json
{
  "answer": "Based on the OCR text, the total was $285.66",
  "confidence": "high",
  "needs_image": false,
  "source_memory": "filepath"
}
```

If `needs_image: true`, the system fetches the image and sends a follow-up with the image attached.

### Response format

The answer always includes:
1. The actual answer to the question
2. A reference to the source memory (so the user can verify)
3. Optionally the memory itself (image, URL, etc.) for context

On Telegram:
```
The total was $285.66 at Cafe 34 Restaurant on April 3, 2026.
📎 Source: restaurant receipt from Apr 5
```
(+ the receipt image attached if relevant)

On email:
```
The total was $285.66 at Cafe 34 Restaurant on April 3, 2026.

Source: restaurant receipt from Apr 5
[attached: receipt image or link to memory]
```

## Scope

- "answer" intent detection (heuristics + LLM)
- Answer action: send full index + question to Claude, get answer grounded in memories
- Two-step image handling: try index data first, fetch image if needed
- Include source reference in the response
- Works on Telegram and email

## Out of scope

- Multi-memory answers ("total of all receipts this month") — requires aggregation
- Answer with computation ("what's the average spend") — just extraction for now
- Proactive answers ("you usually spend X at this restaurant") — no proactive behavior
