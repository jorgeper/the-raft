# Hank CLI

A terminal interface for talking to Hank, a personal AI assistant powered by a [Claude managed agent](https://docs.anthropic.com/en/docs/agents).

Hank CLI is a thin client — all the intelligence (personality, memory, tool use) lives in the managed agent on Anthropic's platform. The CLI just sends your messages and streams back responses.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- A Claude managed agent ID (set up via the Anthropic console or API)

## Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/jorgepereira/jorgepereira.io.git
cd jorgepereira.io/hank-v2/hank-cli
npm install
```

Then link the CLI globally so the `hank` command is available anywhere in your terminal:

```bash
npm link
```

This creates a symlink from your global `node_modules` to this local folder, and wires up the `hank` binary. Since it's a symlink, any changes you make to the source code take effect immediately — no reinstall needed.

To verify it worked:

```bash
hank --help
```

### Uninstalling

```bash
npm unlink -g hank-cli
```

## Setup

The first time you run `hank`, it will ask for your API key:

```
$ hank

  No API key found.

  You can either:
    1. Enter your key now (saved to ~/.config/hank/config.json)
    2. Set the ANTHROPIC_API_KEY environment variable in your shell

  Enter your Anthropic API key (or press Enter to skip): sk-ant-...

  API key saved to ~/.config/hank/config.json
```

This only happens once. The key is stored in `~/.config/hank/config.json` (your home directory, outside the repo).

### Alternative: environment variable

If you already have `ANTHROPIC_API_KEY` set in your shell (e.g., for Claude Code), Hank will use that automatically. The env var takes precedence over the config file.

```bash
# In your ~/.zshrc or ~/.bashrc
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Usage

### Interactive mode

Start a conversation:

```bash
hank
```

This opens an interactive session where you can chat back and forth. Responses stream in real-time. Press `Ctrl+C` to exit.

### One-shot mode

Ask a single question and get an answer:

```bash
hank "what's the capital of france?"
```

Prints the response and exits. Useful for quick lookups or scripting.

### Sessions

By default, Hank resumes your last conversation — you can ask follow-up questions even after closing and reopening the CLI.

To start a fresh conversation:

```bash
hank --new
hank --new "start fresh with this question"
```

### Configuration

```bash
hank config show                     # show current configuration
hank config set apiKey sk-ant-...    # set or update the API key
hank config set agentId agent_...    # set the managed agent ID
```

## How it works

```
You type a message
  → CLI sends it to the Claude managed agent (via Anthropic API)
    → Agent processes it (chat, tools, memory — all server-side)
      → Response streams back as server-sent events
        → CLI renders it in your terminal
```

There's no special server to run. The CLI talks to the managed agent through the standard Anthropic API (`api.anthropic.com`) using the `@anthropic-ai/sdk` package. You just need your API key and the agent/environment IDs.

The CLI maintains a `session_id` locally so conversations persist across invocations. The managed agent handles everything else — there's no local AI processing, no database, no caching.

## Files

All user data lives in `~/.config/hank/`, outside the repo:

| File | Purpose |
|------|---------|
| `~/.config/hank/config.json` | API key, agent ID, environment ID |
| `~/.config/hank/state.json` | Current conversation session ID |

Nothing sensitive is stored in the project directory.

## Development

Run from source without linking:

```bash
npx tsx src/index.ts
npx tsx src/index.ts "one-shot question"
```

## License

MIT
