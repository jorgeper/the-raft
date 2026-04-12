# Hank v2 — Architecture

## Context

Hank v1 is a Python FastAPI app that serves as a personal assistant accessible via Telegram and email. It uses the Anthropic SDK directly for chat, intent detection, and memory management. The core capabilities are:

- **Chat** — conversational AI with a personality (Claude API)
- **Remember** — save memories as Obsidian-compatible markdown files
- **Recall** — search and retrieve saved memories
- **Slash commands** — instant, no-LLM commands (`/help`, `/memory`, etc.)

Hank v2 replaces the custom Python backend with a **Claude managed agent** hosted on Anthropic's platform, and introduces a **CLI** as the primary interface.

## Why a CLI?

- Direct terminal access — no Telegram/email round-trip
- Scriptable — pipe input/output, integrate with shell workflows
- Interactive REPL for conversations, single-shot mode for quick queries
- Faster iteration during development

## Technology Choice: Node.js + TypeScript

**Yes, Node is a good fit.** Reasons:

- **Anthropic SDK** (`@anthropic-ai/sdk`) — first-class TypeScript support, well-maintained
- **CLI ecosystem** — mature libraries (Commander, Ink, chalk, ora)
- **Startup time** — fast enough for a CLI (~100ms)
- **TypeScript** — type safety without a compile step (Node 22+ supports `--experimental-strip-types`, or use `tsx`)
- **Portable** — runs anywhere Node is installed, easy to distribute via npm

Python would also work (and matches Hank v1), but Node/TS has a stronger CLI tooling ecosystem and the Anthropic TS SDK is excellent.

## High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                   hank-cli                       │
│                                                  │
│  ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │  CLI      │──▶│  Client  │──▶│  Anthropic  │ │
│  │  (REPL /  │   │  Layer   │   │  Managed    │ │
│  │  one-shot)│◀──│          │◀──│  Agent API  │ │
│  └──────────┘   └──────────┘   └─────────────┘ │
│       │                                          │
│       ▼                                          │
│  ┌──────────────────────┐                        │
│  │  Config + State       │                       │
│  │  (~/.config/hank/)    │                       │
│  └──────────────────────┘                        │
└─────────────────────────────────────────────────┘
```

## Components

### 1. CLI Layer (`src/cli.ts`)

Entry point. Two modes:

- **Interactive (REPL):** `hank` — opens a persistent conversation loop with readline-based input. Shows streaming responses in real-time.
- **One-shot:** `hank "what's the weather?"` — sends a single message, prints the response, exits.

Uses **Commander** for argument parsing and subcommands.

```
hank                        # start interactive REPL
hank "question"             # one-shot query
hank --new                  # start a fresh session
hank --verbose              # show full tool output
hank config set key value   # manage configuration
hank config show            # show current config
```

### 2. Client Layer (`src/client.ts`)

Wraps the Anthropic SDK to communicate with the managed agent. Responsibilities:

- Initialize the Anthropic client with API key
- Send messages to the managed agent (create/continue sessions)
- Stream responses back to the CLI layer
- Handle session management (create new sessions, resume existing ones)

The managed agent handles all the intelligence — personality, tool use, memory, intent routing. The client is intentionally thin.

#### How the SDK connects to the managed agent

There is no special URL or server to run. The CLI talks to the managed agent through the **standard Anthropic API** (`api.anthropic.com`) using the `@anthropic-ai/sdk` Node.js package. The SDK handles authentication and routing — you just pass your API key and the agent's identifiers.

Three identifiers are involved:

| Identifier | What it is | Lifecycle |
|---|---|---|
| **Agent ID** | Points to the agent configuration (model, system prompt, tools) | Created once, reused forever |
| **Environment ID** | Points to the container template (networking, packages) | Created once, reused forever |
| **Session ID** | A running conversation with the agent | Created per conversation |

The **agent** and **environment** are set up once (via the Anthropic console or API) and their IDs are stored in the CLI config. The **session** is what the CLI creates each time you start a new conversation.

#### What the code looks like

Creating a new conversation:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey });

// Create a session (= start a new conversation)
// GitHub credentials are passed as container env vars so the agent
// can read/write to the memory repo during this session.
const session = await client.beta.sessions.create({
  agent: agentId,
  environment_id: environmentId,
  container: {
    environment: {
      GITHUB_TOKEN: githubToken,
      GITHUB_REPO: githubRepo,
    },
  },
});

// Open a stream to receive events
const stream = await client.beta.sessions.events.stream(session.id);

// Send a message
await client.beta.sessions.events.send(session.id, {
  events: [{
    type: "user.message",
    content: [{ type: "text", text: "Hello Hank" }],
  }],
});

// Read streaming events
for await (const event of stream) {
  if (event.type === "agent.message") {
    // print response tokens
  } else if (event.type === "session.status_idle") {
    // agent is done, waiting for next input
    break;
  }
}
```

Resuming an existing conversation — just send new events to the same session ID:

```typescript
await client.beta.sessions.events.send(existingSessionId, {
  events: [{
    type: "user.message",
    content: [{ type: "text", text: "Follow-up question" }],
  }],
});
```

Communication is via **server-sent events (SSE)**. The key event types:

| Event | Meaning |
|---|---|
| `user.message` | Sent by the CLI to the agent |
| `agent.message` | Agent's text response (streamed) |
| `agent.tool_use` | Agent is calling a tool (bash, web search, etc.) |
| `session.status_idle` | Agent finished, waiting for next input |
| `session.status_terminated` | Session ended |

### 3. Config Manager (`src/config.ts`)

Stores CLI configuration in `~/.config/hank/config.json`:

```json
{
  "apiKey": "sk-ant-...",
  "agentId": "agent_...",
  "environmentId": "env_...",
  "githubToken": "ghp_...",
  "githubRepo": "https://github.com/jorgeper/brain"
}
```

- **API key:** resolved via `ANTHROPIC_API_KEY` env var > config file > interactive prompt (see [API Key Management](#api-key-management))
- **Agent ID / Environment ID:** identify which managed agent to talk to — set once during initial setup
- **GitHub token / repo:** passed to the agent's container as environment variables on every session creation. The managed agent uses these to read/write to a GitHub repo for persistent memory. Resolved via `GITHUB_TOKEN` / `GITHUB_REPO` env vars or config file.

Runtime state (current session ID) is stored separately in `~/.config/hank/state.json` so it doesn't mix with user configuration.

### 4. State (`src/config.ts`)

Minimal runtime state in `~/.config/hank/state.json`:

- Current `session_id` — so the CLI can resume the last conversation
- Updated automatically when a new session is created
- `hank --new` clears the session ID and starts fresh

## Project Structure

```
hank-cli/
├── src/
│   ├── index.ts          # entry point, bin target
│   ├── cli.ts            # argument parsing, REPL loop
│   ├── client.ts         # Anthropic SDK wrapper, SSE event handling
│   ├── config.ts         # config + state file management
│   ├── render.ts         # terminal UI: colors, spinners, streaming output
│   └── types.ts          # shared TypeScript types
├── package.json
├── tsconfig.json
├── .gitignore            # excludes .env, node_modules, dist
└── .env.example          # template showing required env vars
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Anthropic API / managed agent SSE communication |
| `commander` | CLI argument parsing and subcommands |
| `chalk` | Terminal colors — cyan for tools, dim for thinking, red for errors, etc. |
| `ora` | Animated spinners for thinking, tool execution, connecting |
| `marked` + `marked-terminal` | Render markdown (code blocks, bold, lists) in the terminal |
| `log-update` | In-place line updates — spinners replace themselves with checkmarks |
| `readline` (built-in) | Interactive REPL input |

Dev dependencies: `typescript`, `tsx` (for development), `@types/node`.

No database, no local caching, no offline mode. Keep it simple.

## Sessions & Memory

### How sessions work

The managed agent API uses **sessions** to maintain conversation context. Each session has a unique `session_id` returned when you create one. As long as you keep sending messages to the same session, the agent remembers everything said in that conversation.

- **Within a session:** The agent sees the full conversation history. You can ask follow-up questions, reference earlier messages, etc.
- **Across sessions:** When you create a new session, the agent starts fresh — no memory of previous sessions unless the agent has persistent tools (like a knowledge base tool configured on the agent itself).

### What the CLI exposes

The CLI tracks the current `session_id` in `~/.config/hank/state.json`. By default, it resumes the last conversation:

```
hank                     # continues last conversation
hank --new               # starts a fresh conversation (new session)
hank --new "question"    # one-shot with a fresh session
```

This keeps things simple — you get continuity by default, and `--new` when you want a clean slate.

### Long-term memory

Long-term memory (remembering things across sessions) is the **agent's responsibility**, not the CLI's. If the managed agent has tools configured for persistent storage (e.g., a knowledge base, file storage), it can save and recall information across sessions. The CLI doesn't need to know about this — it just sends messages and displays responses.

## Key Design Decisions

### Streaming responses

The CLI streams responses token-by-token as they arrive from the managed agent via SSE. Different event types get different visual treatment — thinking shows a dim spinner, tool use shows an animated status line that resolves to a checkmark, and response text streams smoothly in real-time. The `client.ts` layer exposes an async iterator of typed events that `render.ts` maps to visual output.

### Managed agent as the brain

The CLI is a **dumb terminal**. All intelligence lives in the managed agent — personality, tool use, memory, intent routing. This means:
- The CLI doesn't need to know about intents, memories, or actions
- Upgrading the agent's capabilities doesn't require a CLI update
- Multiple interfaces (CLI, Telegram, web) can share the same agent

### Config file location

Follows XDG base directory spec: `~/.config/hank/`. Falls back to `~/.hank/` on systems without XDG support.

## API Key Management

The code lives on GitHub, so the API key must never be in the repo. Since this is a personal-use CLI, we keep it simple and secure.

### Resolution order

The CLI resolves the API key in this order, using the first one found:

1. **`ANTHROPIC_API_KEY` env var** — standard approach, works if you've already set it for Claude Code or other tools.
2. **`~/.config/hank/config.json`** — local config file, outside the repo.
3. **Interactive setup prompt** — if neither of the above exist, the CLI walks you through setup (see below).

### First-run setup

When you run `hank` for the first time and any config value is missing, the CLI walks you through each one. For every field it explains what it is, where to get it, and prompts for the value:

```
$ hank

  Hey, I'm Hank! Let's get me set up so we can chat.

  This authenticates you with the Anthropic API.
    Get one at: https://console.anthropic.com/settings/keys
  Anthropic API key (or set ANTHROPIC_API_KEY env var): sk-ant-...

  The ID of your Claude managed agent.
    You get this when you create an agent in the Anthropic console or via the API.
  Agent ID: agent_...

  ...

  Config saved to ~/.config/hank/config.json
```

The flow:
- For each required field, check env var (if applicable) then config file.
- Only prompt for values that are actually missing — if you already have `ANTHROPIC_API_KEY` set as an env var, it skips that one.
- All entered values are saved to `config.json` at the end.
- If the user leaves a field empty, it exits with instructions on how to set it via `hank config set` or env var.

This only happens once. After everything is configured, `hank` starts immediately.

### Manual config commands

All values can also be set or updated individually, bypassing the guided setup:

```
hank config set apiKey sk-ant-...            # Anthropic API key
hank config set agentId agent_...            # managed agent ID
hank config set environmentId env_...        # container environment ID
hank config set githubToken ghp_...          # GitHub personal access token
hank config set githubRepo https://...       # memory storage repo
hank config show                             # show current config (secrets masked)
```

## Streaming Events & Live State

### How the agent communicates progress

The managed agent API streams **server-sent events (SSE)** for every step of its work. The stream is never silent — the CLI always knows what the agent is doing.

Full event flow for a complex task:

```
agent.thinking           → agent reasoning about the task
agent.message            → "I'll create the script and test it..."
agent.tool_use           → bash: cat > fibonacci.py << 'EOF' ...
agent.tool_result        → (file written)
agent.tool_use           → bash: python fibonacci.py
agent.tool_result        → "1, 1, 2, 3, 5, 8..."
agent.message            → "Done. Here's what I did..."
session.status_idle      → ready for next input
```

### Event types the CLI handles

| Event | What it means |
|---|---|
| `agent.thinking` | Agent is reasoning (extended thinking / chain-of-thought) |
| `agent.message` | Agent's text response, streamed token-by-token |
| `agent.tool_use` | Agent invoked a tool (bash, file ops, web search, etc.) |
| `agent.tool_result` | Tool finished, here's the output |
| `agent.mcp_tool_use` | Agent invoked an MCP server tool |
| `agent.mcp_tool_result` | MCP tool finished |
| `session.status_running` | Agent is actively working |
| `session.status_idle` | Agent finished, waiting for input |
| `session.status_terminated` | Session ended |
| `span.model_request_start` | An inference call started |
| `span.model_request_end` | An inference call finished (includes token counts) |

### Disconnection recovery

Sessions survive client disconnects — the agent keeps running. When the CLI reconnects:

1. Reopen the SSE stream
2. Fetch missed events via `client.beta.sessions.events.list(sessionId)`
3. Resume streaming, skipping already-seen event IDs

## Terminal UI & Visual Design

The CLI uses colors, animations, and formatting to make the agent's state clear at a glance. Think modern CLI tools like Claude Code, Vercel CLI, or Railway.

### Color scheme

| Element | Color | Why |
|---|---|---|
| Agent response text | **white** (default) | Primary content, easy to read |
| Thinking indicator | **dim gray / italic** | De-emphasized, secondary to the response |
| Tool name & action | **cyan** | Distinct from response text, signals "system activity" |
| Tool output | **dim white** | Visible but subordinate to the agent's response |
| Error messages | **red** | Immediately noticeable |
| Success / status | **green** | Positive confirmation |
| User prompt marker | **bold blue** `>` | Clear input boundary |
| Session info | **dim yellow** | Metadata, not primary content |

### Animated states

The CLI uses `ora` spinners and dynamic line updates to show activity:

- **Thinking:** Animated spinner with dim italic text
  ```
  ⠋ Thinking...
  ```

- **Tool execution:** Spinner with tool name in cyan, replaces itself when done
  ```
  ⠋ Running bash command...
  ✓ bash (0.3s)
  ```

- **Connecting:** Spinner on session creation
  ```
  ⠋ Connecting to Hank...
  ```

- **Streaming response:** No spinner — tokens appear character-by-character as they stream in. The cursor sits at the end of the growing text.

### Example session rendering

```
  Hank CLI v0.1.0 — session resumed

> Write a Python script that generates fibonacci numbers and test it

  ⠋ Thinking...

  I'll create a fibonacci script and verify it works.

  ⠋ Writing fibonacci.py...
  ✓ bash — wrote fibonacci.py (0.2s)

  ⠋ Running tests...
  ✓ bash — python fibonacci.py (0.4s)
  │ 1, 1, 2, 3, 5, 8, 13, 21, 34, 55

  Done — the script generates the first 10 Fibonacci numbers correctly.
  The file is saved as `fibonacci.py`.

> _
```

Key visual principles:
- **Spinners replace themselves** with a checkmark + summary when done — no log spam
- **Tool output is indented** with a `│` border to visually nest it under the tool action
- **Response text streams smoothly** — no flickering, no buffered chunks
- **Minimal chrome** — no boxes, no heavy borders, just clean indentation and color

### Verbose mode

By default, tool output is collapsed to a summary line. `hank --verbose` shows full tool output:

```
> Search for recent news about TypeScript

  ⠋ Thinking...

  ✓ web_search — "TypeScript 2026 news" (1.2s)
  │ [1] TypeScript 5.8 Released — microsoft.com
  │ [2] TypeScript Gets Native Go Compiler — devblogs.microsoft.com
  │ [3] Deno 4.0 Drops TypeScript Compiler — deno.com

  Here are the latest highlights...
```

In default (non-verbose) mode, the same interaction would show:

```
  ✓ web_search (1.2s)

  Here are the latest highlights...
```

## Distribution

For a personal CLI, the simplest modern approach: **`npm link` during development, global install from local path for daily use.**

```bash
# During development — symlinks the package globally
cd hank-cli && npm link

# Now available anywhere as:
hank "hello"
```

This works because `package.json` declares a `bin` field that maps the `hank` command to the entry point. No publishing to npm needed. If you ever want to share it:

- **npm publish** — `npx hank` works anywhere (most standard)
- **Bun compile** — `bun build --compile` produces a single standalone binary (most modern, no Node required to run)

## Next Steps

1. Scaffold the Node.js project (`package.json`, `tsconfig.json`)
2. Implement `config.ts` — first-run setup, API key storage
3. Implement `client.ts` — connect to managed agent, send/receive messages
4. Implement `cli.ts` — REPL loop with streaming output
5. Add one-shot mode and polish the terminal UX
