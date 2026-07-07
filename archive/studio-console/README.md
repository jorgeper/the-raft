# Studio Console

A terminal dashboard for [Agent Studio](../agent-studio/README.md): watch your
agents work in real time, read their output nicely formatted, follow GoalLoop
progress task by task, and browse the backlog — all from the terminal, built on
[Textual](https://textual.textualize.io/) and Rich.

```
┌ studio-console ── backlog 2 · specs 1 · coding 1 · review 1 · needs-you 2 ────┐
│ ACTIVE NOW                        │ EVENTS                                    │
│ ▶ coder      #4  GoalLoop  03:12  │ 12:01:44 ✔ gate_result  pytest -q  ok     │
│   iter 3/10  tasks ▮▮▮▯▯ 3/5      │ 12:01:40 ⚙ iteration_start #4 t4          │
│ ▶ reviewer-a #2  review    00:41  │ 12:01:12 ✚ comment_added #2 reviewer-b    │
│                                   │ 12:00:58 ⇢ transition #2 → pr:agent-review│
└───────────────────────────────────┴───────────────────────────────────────────┘
```

It is deliberately **decoupled**: the console consumes only Agent Studio's
[observability contract](../agent-studio/docs/architecture/07-observability.md)
(the `events.jsonl` stream plus `status --json` / `show --json` snapshots) and
never imports studio code or reads tracker internals. It is also **read-only**:
approving and merging stay in `studio approve` and your own hands, by design.

## Quickstart (no Agent Studio needed)

```sh
cd studio-console
uv venv .venv && uv pip install --python .venv/bin/python \
  textual rich pyyaml pytest pytest-cov pytest-asyncio ruff
make demo     # replays a recorded full lifecycle at 20x — a moving dashboard
make verify   # the acceptance checklist
```

`make demo` replays `fixtures/demo-events.jsonl` — a real event stream recorded
from Agent Studio's own demo — so you can explore every screen with zero setup.

## Pointing it at a real studio

Edit `config.yaml`:

```yaml
studio:
  root: ../agent-studio          # the studio whose events you want to watch
  python: ../agent-studio/.venv/bin/python   # used for snapshot commands
poll:
  events_ms: 250                 # tail cadence
  snapshot_s: 5                  # board refresh cadence
```

Then, with the studio's orchestrator running (`studio run --watch`):

```sh
make run
```

## Screens and keybindings

| Key | Screen | What you see |
|---|---|---|
| `1` | **Dashboard** | active dispatches with elapsed timers and loop task-progress bars; the live event feed (enter expands an event's full tail) |
| `2` | **Board** | items grouped by state in pipeline order, "Needs you" pinned on top; arrow keys + `enter` to open an item |
| `3` | **Item detail** | the comment thread as rendered Markdown, a state-history timeline, `l` jumps to the loop panel when a GoalLoop ran |
| `4` | **Runs** | browse `runs/<stamp>-<item>-<agent>/`, view prompts and outputs rendered as Markdown |
| `q` | — | quit |
| `?` | — | help overlay with all bindings |

Colors follow the studio's label scheme: red means it needs you, blue/purple are
agent lanes, green is done.

## Modes

```sh
python -m studio_console                                   # live (config.yaml)
python -m studio_console --replay fixtures/demo-events.jsonl --speed 20
python -m studio_console --check --events <file>           # headless: parse, fold,
                                                           # summarize, exit 0/1
```

`--check` is the scriptable smoke test — CI-friendly, and handy over SSH when you
just want "is anything stuck?" without the UI.

## How it stays decoupled

Three rules, enforced by `scripts/verify.sh`:

1. Only the contract: events stream, snapshot CLI, `runs/` and `.loop/` paths that
   events point to.
2. Never `import studio.*` (grepped on every verify).
3. Unknown event kinds render raw instead of crashing — the stream may grow
   (additively, within `v: 1`) without the console needing a release.

## Development

```sh
make test     # offline: fixtures + fakes, no studio, no network
make lint
make verify   # spec.md §8 — includes running agent-studio's own verifies
```

The spec that built this is [spec.md](spec.md); decisions made along the way are
in [DECISIONS.md](DECISIONS.md).
