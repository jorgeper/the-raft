# Email Me: Send memories to my inbox

Ask Hank to email you a saved memory — from Telegram or email. Useful when you're on your phone and want to send yourself an article, receipt, or note to read later on your computer.

## User stories

- "Email me that article about AI agents" → Hank finds it, emails it to you
- "Send me the receipt from Cafe 34" → Hank finds the receipt image, emails it as an attachment
- "Email me everything I saved today" → Hank bundles today's memories and emails a summary
- (on Telegram) "Email me this" after sharing a URL → Hank remembers the URL and emails it to you

## How it works

### Intent detection

Add "email-me" as a new intent, or treat it as a modifier on recall. Two approaches:

**Option A: Separate intent**
- "email me", "send me an email", "send to my email" → intent: "email-me"
- Then search for the memory (same as recall), but instead of replying in-channel, send it via email

**Option B: Modifier on recall** (recommended)
- Same recall flow, but when the user says "email me" in the query, the recall result gets emailed instead of returned in-channel
- Simpler — reuses all the recall infrastructure
- The recall action detects "email me" in the query and sets a flag

**Recommendation:** Option B. The recall action already finds the memory. Just add a delivery method flag.

### Flow

```
User (Telegram): "Email me that restaurant receipt"
  → Intent: recall (heuristic: "email me" starts like recall)
  → Recall finds the receipt
  → Detects "email me" in the query → delivery = email
  → Sends the memory via Mailgun to the user's configured email
  → Replies in Telegram: "Sent to jorgeper@gmail.com ✓"
```

### What gets emailed

Depends on the memory type:

| Memory type | Email content |
|-------------|--------------|
| **note** | Subject = memory title, body = full markdown text |
| **url** | Subject = page title or URL, body = URL + any saved notes |
| **image** | Subject = memory title, body = AI description, attachment = the image |
| **email (with HTML)** | Subject = original subject, body = original HTML (full fidelity) |

### Who receives the email

The user's email address. Options for configuration:

1. **ALLOWED_EMAIL_SENDERS** — already configured, use this as the default recipient
2. **Telegram user → email mapping** — a new env var like `USER_EMAIL_MAP=123456789:jorgeper@gmail.com`
3. **Ask the user** — "What email should I send it to?" (first time only, remember for future)

**Recommendation:** Use `ALLOWED_EMAIL_SENDERS` as the default. If there's exactly one email, use that. If multiple, ask which one. Can add a `/email` command later to configure it.

Alternatively, a simple `DEFAULT_EMAIL=jorgeper@gmail.com` env var.

### Sending via Mailgun

Already have the Mailgun send infrastructure (`_send_reply` in email_handler.py). Extract it into a shared module so both the email handler and the email-me action can use it.

For attachments (images), Mailgun supports file attachments in the send API:
```python
files={"attachment": ("receipt.jpg", open(image_path, "rb"), "image/jpeg")}
```

### Email-me from email

If you're already on email and say "email me that receipt", Hank can just reply to the email thread with the memory content. The existing `_send_reply` handles this — just change the body to be the memory content instead of a chat reply.

## File structure

```
app/
├── actions/
│   ├── recall.py          # Updated: detect "email me" modifier, return delivery flag
│   └── email_send.py      # Shared email sending (extracted from email_handler.py)
```

## Scope

- Detect "email me" in recall queries → flag delivery as email
- Send memory content via Mailgun to configured email
- Support text, URL, image (as attachment), and HTML memories
- `DEFAULT_EMAIL` env var for recipient
- Reply in-channel with confirmation ("Sent to your email ✓")

## Out of scope

- Email to arbitrary addresses ("email this to john@example.com")
- Bulk email ("email me everything from this week")
- Scheduled email ("email me this tomorrow morning")
- PDF generation (format memories as PDF before emailing)
