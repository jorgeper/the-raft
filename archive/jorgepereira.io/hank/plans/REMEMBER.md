# Remember: Save things via email

Forward emails to `remember@hank.jorgepereira.io` and Hank stores the content as markdown files on disk. Simple, durable, no database.

## How it works

```
You → email remember@hank.jorgepereira.io → Mailgun → POST /email → RememberProcessor → save to disk → reply "Got it"
```

1. You forward or send an email to `remember@hank.jorgepereira.io`
2. Mailgun receives it and POSTs to the webhook endpoint
3. The app routes it to a new `RememberProcessor` (not the Claude processor)
4. The processor saves the email content as a markdown file on disk
5. Hank replies: "Got it, I'll remember that."

## Routing by recipient address

The email handler currently sends everything to a single processor. For this feature, it needs to route based on the recipient address:

- `hank@hank.jorgepereira.io` → `ClaudeProcessor` (chat, as before)
- `remember@hank.jorgepereira.io` → `RememberProcessor` (save to disk)

This means the email handler needs to read the `to` field from the Mailgun webhook and pick the right processor.

## Storage format

Saved memories are markdown files organized by date:

```
data/memories/
├── 2026-04-05/
│   ├── 2026-04-05T21-33-02_wifi-password.md
│   ├── 2026-04-05T21-45-10_youtube-link.md
│   └── 2026-04-05T22-01-44_meeting-notes.md
├── 2026-04-06/
│   └── 2026-04-06T09-15-22_recipe.md
```

Each markdown file:

```markdown
# <subject line>

**From:** you@gmail.com
**Date:** 2026-04-05 21:33:02

---

<email body content>
```

- Folder per day (`YYYY-MM-DD`)
- Filename: `<timestamp>_<slugified-subject>.md`
- If no subject, use first few words of the body as the slug
- The `data/memories/` directory is mounted as a Docker volume so it survives container rebuilds

## Mailgun setup

Add a second inbound route in Mailgun:

- **Match:** `match_recipient("remember@hank.jorgepereira.io")`
- **Action:** Forward to `https://hank.jorgepereira.io/email`

Both `hank@` and `remember@` go to the same endpoint — the app routes internally based on the recipient.

## What the RememberProcessor does

1. Receive the email content (subject, body, sender, timestamp)
2. Create the day folder if it doesn't exist
3. Write the markdown file
4. Return a confirmation message: "Got it, I'll remember that." (or similar)

## Scope

- Email only (Telegram later)
- Text content only (no attachments yet)
- No search/recall yet — just saving
- No Claude involved — the RememberProcessor doesn't need AI, it just writes files

## Out of scope (future)

- Telegram integration (forward messages to Hank with a keyword to remember)
- Attachment handling (save images, PDFs, etc.)
- Search/recall ("what did I save about wifi?")
- AI-generated summaries or tags on saved memories
- The broader memory feature from `plans/MEMORY.md` — this is a simpler first step
