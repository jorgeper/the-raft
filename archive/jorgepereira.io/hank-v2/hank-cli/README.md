# Hank CLI

A terminal interface for talking to Hank, a personal AI assistant powered by a [Claude managed agent](https://docs.anthropic.com/en/docs/agents).

Hank CLI is a thin client — all the intelligence (personality, memory, tool use) lives in the managed agent on Anthropic's platform. The CLI just sends your messages and streams back responses.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- A Claude managed agent ID and environment ID (set up via the Anthropic console or API)
- A [GitHub personal access token](https://github.com/settings/tokens) with repo access
- A GitHub repository for the agent's memory storage

## Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/jorgepereira/jorgepereira.io.git
cd jorgepereira.io/hank-v2/hank-cli
npm install
```

Build and link the CLI globally so the `hank` command is available anywhere in your terminal:

```bash
npm run build
npm link
```

This creates a symlink from your global `node_modules` to this local folder, and wires up the `hank` binary. Since it's a symlink, any changes you make to the source code take effect immediately (after `npm run build`) — no reinstall needed.

> **Permission error?** If `npm link` fails with `EACCES`, your global `node_modules` is owned by root. Either run `sudo npm link`, or configure npm to use a directory you own:
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix '~/.npm-global'
> # Add to your ~/.zshrc or ~/.bashrc:
> export PATH="$HOME/.npm-global/bin:$PATH"
> ```
>
> Then restart your shell and run `npm link` again (no sudo needed).

To verify it worked:

```bash
hank --help
```

### Uninstalling

```bash
npm unlink -g hank-cli
```

## Setup

### Guided setup (recommended)

The first time you run `hank`, it walks you through all the configuration you need:

```
$ hank

  Hey, I'm Hank! Let's get me set up so we can chat.

  This authenticates you with the Anthropic API.
    Get one at: https://console.anthropic.com/settings/keys
  Anthropic API key: sk-ant-...

  The ID of your Claude managed agent.
    Find it in the Anthropic console: console.anthropic.com > Agents > your agent > copy the ID.
  Agent ID: agent_...

  The container environment your agent runs in.
    Find it in the Anthropic console: console.anthropic.com > Environments tab > copy the ID.
  Environment ID: env_...

  A personal access token so the agent can read/write to your memory repo.
    Create one at: https://github.com/settings/tokens (needs repo access).
  GitHub token: ghp_...

  The GitHub repo where Hank stores memories.
    This is passed to the agent's container as an environment variable.
  GitHub repo URL: https://github.com/your-user/your-repo

  Config saved to ~/.config/hank/config.json
```

This only happens once. Everything is stored in `~/.config/hank/config.json` (your home directory, outside the repo).

### Manual setup

If you prefer, you can set each value individually:

```bash
hank config set apiKey sk-ant-...                          # from console.anthropic.com/settings/keys
hank config set agentId agent_...                          # from console.anthropic.com > Agents
hank config set environmentId env_...                      # from console.anthropic.com > Environments
hank config set githubToken ghp_...                        # from github.com/settings/tokens
hank config set githubRepo https://github.com/user/repo    # your memory storage repo
```

### Environment variables

For `apiKey`, `githubToken`, and `githubRepo`, you can also use environment variables. Env vars take precedence over the config file.

```bash
# In your ~/.zshrc or ~/.bashrc
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="ghp_..."
export GITHUB_REPO="https://github.com/your-user/your-repo"
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
hank config show                             # show current configuration
hank config set apiKey sk-ant-...            # set or update the API key
hank config set agentId agent_...            # set the managed agent ID
hank config set environmentId env_...        # set the environment ID
hank config set githubToken ghp_...          # set the GitHub token
hank config set githubRepo https://...       # set the GitHub memory repo
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
| `~/.config/hank/config.json` | API key, agent ID, environment ID, GitHub token/repo |
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
