# PRD: Multi-Account Support

## Problem

Hank is currently a single-tenant system. All memories go into one shared pool, conversation history is keyed only by `chat_id`, and access control is a flat allowlist of Telegram IDs and email addresses. There is no concept of "who owns this data."

This means:
- A friend who creates their own Telegram bot and shares the token cannot get their own isolated Hank experience.
- All memories from all users mix together in `data/memories/`.
- Conversation context bleeds across users who happen to share a chat ID space.
- The web UI only supports a single `ALLOWED_EMAIL`.

## Goal

Introduce an **Identity** abstraction that ties together a person's various contact methods (Telegram ID, email address, future channels) into a single logical user. Each identity gets its own isolated storage, conversation context, and configuration.

## Identity Model

```
Identity
├── id: str                      # stable unique key (e.g. slug or UUID)
├── name: str                    # display name ("Jorge", "Alex")
├── telegram_ids: list[int]      # one or more Telegram user IDs
├── emails: list[str]            # one or more email addresses
├── created_at: datetime
└── [extensible: future fields]
```

### Resolution

When a message arrives from any channel, the system resolves the sender to an Identity:

| Channel  | Lookup key              |
|----------|------------------------|
| Telegram | `update.effective_user.id` |
| Email    | sender email address   |

Resolution rules:
1. Look up the channel-specific identifier in the identity registry.
2. If found, use that identity for the entire request lifecycle.
3. If not found, reject the message (no anonymous access).

### Registry

Identities are defined in a configuration file (`identities.json` or equivalent) rather than a database. This keeps the system file-based and simple:

```json
[
  {
    "id": "jorge",
    "name": "Jorge",
    "telegram_ids": [123456789],
    "emails": ["jorge@example.com"]
  },
  {
    "id": "alex",
    "name": "Alex",
    "telegram_ids": [987654321],
    "emails": ["alex@example.com"]
  }
]
```

This replaces `ALLOWED_USER_IDS` and `ALLOWED_EMAIL_SENDERS` -- the registry itself is the allowlist.

## Storage Isolation

### Current

```
data/memories/
├── 2026-04-05/
│   ├── 2026-04-05T21-33-02_wifi-password.md
│   └── ...
└── index.json
```

### Proposed

```
data/
├── jorge/
│   └── memories/
│       ├── 2026-04-05/
│       │   └── ...
│       └── index.json
├── alex/
│   └── memories/
│       ├── 2026-04-05/
│       │   └── ...
│       └── index.json
└── identities.json
```

Each identity's data lives under `data/{identity.id}/`. This gives complete isolation:
- Memories are private per user.
- Search indexes are scoped per user.
- Future per-user data (preferences, etc.) lives naturally under the same path.

## Conversation Context Isolation

`ChatAction._history` is currently `dict[int, list]` keyed by `chat_id`. This must be scoped by identity:

**Option A (simple):** Prefix the history key: `(identity_id, chat_id)` tuple.

**Option B (cleaner):** Each identity gets its own `ChatAction` instance (or equivalent isolated state).

Recommendation: **Option A** -- minimal change, same effect. The `chat_id` still distinguishes multiple conversations for the same user (e.g. Telegram vs email), while the identity scopes it so users never share context.

## Affected Components

### hank/app (bot)

| Component | Change |
|-----------|--------|
| **Identity registry** (new) | Load `identities.json`, resolve sender → identity |
| **bot.py** | Resolve Telegram user → identity before processing. Replace `ALLOWED_USER_IDS` check with identity lookup. |
| **email_handler.py** | Resolve email sender → identity. Replace `ALLOWED_EMAIL_SENDERS` check with identity lookup. |
| **processor.py** | `process()` signature gains `identity` parameter |
| **processors/hank.py** | Pass identity through to actions |
| **actions/remember.py** | Write to `data/{identity.id}/memories/` instead of `data/memories/` |
| **actions/recall.py** | Read index from `data/{identity.id}/memories/index.json` |
| **actions/chat.py** | Key history by `(identity_id, chat_id)` |
| **memory_index.py** | Accept base path parameter (identity-scoped) |
| **commands/memory.py** | Scope listing to current identity |
| **commands/index_cmd.py** | Rebuild index for current identity only |
| **main.py** | Load identity registry at startup. Remove `ALLOWED_USER_IDS` / `ALLOWED_EMAIL_SENDERS` parsing. |

### hank-web (web UI)

| Component | Change |
|-----------|--------|
| **auth.py** | After OAuth, resolve email → identity. Reject if no identity found. Store identity in session. |
| **api.py** | Scope all memory API endpoints to the authenticated identity's data directory. |
| **app.html** | No change needed (paths are relative). |

### Infrastructure

| Component | Change |
|-----------|--------|
| **docker-compose.yml** | Volume mount now covers `data/` root (already does). No change needed. |
| **.env.example** | Remove `ALLOWED_USER_IDS`, `ALLOWED_EMAIL_SENDERS`, `ALLOWED_EMAIL`. Add `IDENTITIES_FILE` (default: `data/identities.json`). |

## Migration

For existing single-user data:

1. Create `data/identities.json` with the current user as the sole entry.
2. Move `data/memories/` to `data/{identity.id}/memories/`.
3. Done. No data format changes within memory files.

A migration script should handle this automatically on first boot when `data/memories/` exists but no `identities.json` is found.

## Multi-Bot Deployment

The friend scenario: Alex runs their own Telegram bot (different `TELEGRAM_BOT_TOKEN`), but both bots point to the same Hank backend. This requires:

- **Same deployment, different bot tokens:** Not directly supported by python-telegram-bot (one bot per `Application` instance). We'd need to either:
  - (a) Run separate Hank containers per bot, sharing the `data/` volume, or
  - (b) Support multiple bot tokens in a single process (multiple `Application` instances).

- **Recommendation:** Option (a) is simpler and more robust. Each friend runs their own container with their own bot token, but all containers mount the same `data/` volume. Identity resolution ensures data isolation regardless.

For this to work safely with shared storage, file writes should be atomic (write-then-rename, which the current code already does for memories).

## What This Does NOT Cover

- Shared memories between users (explicit sharing/collaboration).
- Per-user Claude API keys or billing.
- Admin roles or permissions beyond "is this person a known identity."
- User self-registration (identities are admin-managed via config file).

## Success Criteria

1. Two users with different Telegram bots can use the same Hank deployment.
2. Each user's memories are fully isolated -- they cannot see or search each other's data.
3. Each user's conversation context is isolated.
4. The web UI shows only the authenticated user's memories.
5. Existing single-user deployments migrate automatically with zero data loss.
6. Adding a new user requires only editing `identities.json` and restarting.
