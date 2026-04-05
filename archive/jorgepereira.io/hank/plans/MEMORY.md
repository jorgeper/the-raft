# Memory: Save and Recall

Hank remembers things you send him — text notes, URLs, photos, whatever. Send it, forget about it, ask for it later.

## User stories

- "Hey Hank, remember this: the wifi password at the cabin is `trout42`" → Hank saves it
- Send a YouTube link → Hank saves it with the URL and any message you included
- Send a photo → Hank saves the image file (no analysis yet — that's a future phase)
- "What was the wifi password?" → Hank searches saved memories and returns it
- "What links did I save this week?" → Hank lists them

## Scope

1. **Storage layer** — saves items with timestamp, type, and content
   - Types: `note` (text), `url` (link), `photo` (file reference)
   - Storage: SQLite file (simple, no external DB needed, persists across restarts)
   - Mount a Docker volume so data survives container rebuilds

2. **Intent detection** — is the user saving something or asking for something?
   - Use Claude to classify: "save" vs "recall" vs "chat" (normal conversation)
   - If save: extract what to remember and store it
   - If recall: search memories and return matches
   - If chat: handle as normal (existing flow)

3. **Handle different message types:**
   - Text with a URL → extract and save as `url` type with any surrounding text as context
   - Text without URL → save as `note` type
   - Photo → download the file from Telegram, save to disk, store file path as `photo` type

4. **Recall via search** — when the user asks for something, search memories:
   - Use Claude to generate a search query from the user's question
   - Search memory content with simple text matching (full-text search in SQLite)
   - Return matching memories with timestamps

5. **Commands:**
   - `/memories` — list recent saved memories
   - `/forget <id>` — delete a specific memory

## Out of scope (future)

- Image analysis: run photos through Claude vision to extract description/metadata for better search
- Tags/categories: auto-tag memories for structured recall
- Embeddings: vector search for semantic recall instead of text matching
- Periodic summaries: "here's what you saved this week"
