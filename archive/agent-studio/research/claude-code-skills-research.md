# Skills & Agent Bundles in Claude Code / Agent SDK (mid-2026)

*Research compiled 2026-07-06 to ground spec.md §3.3 (agent definitions with skills).*

Sources: https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/sub-agents ·
https://code.claude.com/docs/en/agent-sdk/skills · https://code.claude.com/docs/en/plugins-reference ·
https://code.claude.com/docs/en/headless · https://agentskills.io/specification ·
https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

## 1. SKILL.md format (agentskills.io open standard, extended by Claude Code)

A skill = a directory whose entrypoint is `SKILL.md` (YAML frontmatter + markdown body):

```text
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code (run, not loaded into context)
├── references/       # Optional: docs loaded on demand
└── assets/           # Optional: templates, images, data files
```

Spec frontmatter: `name` (≤64 chars, lowercase alnum + hyphens, **must match parent
directory name**), `description` (required, ≤1024 chars, "what + when"), `license`,
`compatibility`, `metadata` (string map), `allowed-tools` (experimental). Validator:
`skills-ref validate ./my-skill`.

Claude Code extras (all optional): `when_to_use`, `argument-hint`, `arguments` (named
positional args), `disable-model-invocation` (user-only), `user-invocable: false`
(model-only background knowledge), `allowed-tools` (pre-approves, does not restrict),
`disallowed-tools`, `model`/`effort` overrides, `context: fork` (run as subagent) +
`agent: <name>`, `hooks` (skill-scoped), `paths` (glob-triggered auto-load), `shell`.
Body substitutions: `$ARGUMENTS`, `$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`;
`` !`cmd` `` runs before the model sees content and inlines output.

**Discovery:** `~/.claude/skills/<name>/SKILL.md` (personal), `.claude/skills/<name>/`
(project, plus parent dirs up to repo root and nested dirs on demand), plugin `skills/`.
Enterprise > personal > project on clashes. `--add-dir` loads `.claude/skills/` from
added dirs.

**Progressive disclosure:** (1) name+description of every skill in system prompt
(~100 tokens each, 1% of context budget); (2) body loaded on invocation (<500 lines
recommended); (3) supporting files read on demand; (4) scripts executed, never loaded.

## 2. Subagent definitions — the native "bundle" format

`.claude/agents/<name>.md`: markdown body = system prompt (replaces default). Frontmatter
(only `name` + `description` required):

`name`, `description`, `tools` (allowlist), `disallowedTools`, `model`
(`sonnet|opus|haiku|fable|<full-id>|inherit`), `permissionMode`, `maxTurns`, **`skills`**,
**`mcpServers`**, **`hooks`**, **`memory`** (`user|project|local`), `background`,
`effort`, `isolation: worktree`, `color`, `initialPrompt`.

**`skills:` field = preloading, not access control:**

```yaml
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---
Implement API endpoints. Follow the conventions from the preloaded skills.
```

- Full skill content is **injected at startup** (not just descriptions).
- Without the field, subagents can still discover/invoke any project/user skill via the
  Skill tool. To block skills: omit `Skill` from `tools` or add to `disallowedTools`.
- Skills with `disable-model-invocation: true` cannot be preloaded.

**Per-agent MCP** (`mcpServers:` — inline stdio defs or string refs to session servers),
**per-agent hooks** (standard event/matcher/command; active only while agent runs),
**memory** (`.claude/agent-memory/<name>/MEMORY.md`, first 200 lines injected).

**Precedence:** managed settings > `--agents` CLI JSON > `.claude/agents/` >
`~/.claude/agents/` > plugin agents. Plugin-shipped agents ignore `hooks`, `mcpServers`,
`permissionMode` (security).

**An agent can run as the main session:** `claude --agent <name>` — its body replaces the
whole system prompt; frontmatter mcpServers/hooks apply at session level.

## 3. Headless invocation

- `claude -p "..."` loads the same config as interactive: project + user skills, hooks,
  plugins, MCP, CLAUDE.md. `--bare` skips all auto-discovery (recommended for CI).
- `claude -p "/my-skill args"` — user-invoked skills expand in `-p` mode.
- `claude -p "<task>" --agent <name>` — run a defined agent headless.
- Relevant flags: `--allowedTools`, `--disallowedTools`, `--permission-mode`,
  `--system-prompt`, `--agents '<json>'`, `--output-format json|stream-json`,
  `--add-dir`, `--settings <file-or-json>`.
- Agent SDK (TS/Python): subagents via `agents` option; skills are filesystem-only,
  filtered by `skills: "all" | [names] | []` + `setting_sources`; SKILL.md
  `allowed-tools` is CLI-only (SDK uses query-level `allowedTools`).

## 4. Plugins — the distribution wrapper

A plugin bundles skills + agents + hooks + MCP in one directory:

```text
my-plugin/
├── .claude-plugin/plugin.json   # manifest (only `name` required)
├── skills/<name>/SKILL.md
├── agents/*.md
├── hooks/hooks.json
├── .mcp.json                    # paths via ${CLAUDE_PLUGIN_ROOT}
└── scripts/, bin/               # bin/ added to Bash PATH
```

Lightest bundle: drop `.claude-plugin/plugin.json` into a folder under `.claude/skills/`
→ loads in place, no marketplace. Scaffold: `claude plugin init <name> --with skills
agents hooks mcp`. Validate: `claude plugin validate ./my-plugin --strict`.

## 5. Mapping to the studio's agent concept

The subagent markdown file natively expresses the full tuple: body (prompt) + `skills`
(preloaded knowledge) + `tools`/`disallowedTools`/`permissionMode` (permissions) +
`hooks` (lifecycle) + `mcpServers` (connectors) + `memory` (persistence) — runnable as a
subagent, as a main session (`--agent`), or headless (`claude -p --agent <name>`).
For non-Claude runtimes (codex), inline skill bodies into the prompt as a portable
fallback.
