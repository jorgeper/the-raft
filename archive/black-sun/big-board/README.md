# Big Board

A terminal dashboard for [Black Sun](../README.md): watch your
agents work in real time, read their output nicely formatted, follow GoalLoop
progress task by task, and browse the backlog — all from the terminal, built on
[Textual](https://textual.textualize.io/) and Rich.

```
┌ big-board ── backlog 2 · specs 1 · coding 1 · review 1 · needs-you 2 ────┐
│ ACTIVE NOW                        │ EVENTS                                    │
│ ▶ coder      #4  GoalLoop  03:12  │ 12:01:44 ✔ gate_result  pytest -q  ok     │
│   iter 3/10  tasks ▮▮▮▯▯ 3/5      │ 12:01:40 ⚙ iteration_start #4 t4          │
│ ▶ reviewer-a #2  review    00:41  │ 12:01:12 ✚ comment_added #2 reviewer-b    │
│                                   │ 12:00:58 ⇢ transition #2 → pr:agent-review│
└───────────────────────────────────┴───────────────────────────────────────────┘
```

It is deliberately **decoupled**: the console consumes only Black Sun's
[observability contract](../docs/architecture/07-observability.md)
(the `events.jsonl` stream plus `status --json` / `show --json` snapshots) and
never imports blacksun code or reads tracker internals. It is also **read-only**:
approving and merging stay in `blacksun approve` and your own hands, by design.

## Quickstart (no Black Sun needed)

```sh
cd big-board
uv venv .venv && uv pip install --python .venv/bin/python \
  textual rich pyyaml pytest pytest-cov pytest-asyncio ruff
make demo     # replays a recorded full lifecycle at 20x — a moving dashboard
make verify   # the acceptance checklist
```

`make demo` replays `fixtures/demo-events.jsonl` — a real event stream recorded
from Black Sun's own demo — so you can explore every screen with zero setup.

## Pointing it at a real blacksun

Edit `config.yaml`:

```yaml
blacksun:
  root: ..          # the blacksun whose events you want to watch
  python: ../.venv/bin/python   # used for snapshot commands
poll:
  events_ms: 250                 # tail cadence
  snapshot_s: 5                  # board refresh cadence
```

Then, with the blacksun's orchestrator running (`blacksun run --watch`):

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

Navigation is vim-flavored everywhere (lists and detail views): `j`/`k` move,
`g`/`G` jump to top/bottom, `ctrl+d`/`ctrl+u` page (PgUp/PgDn/Home/End also work
natively). In the event feed, `G` re-enables tail-follow after browsing.

Colors follow the blacksun's label scheme: red means it needs you, blue/purple are
agent lanes, green is done.

## Modes

```sh
python -m bigboard                                   # live (config.yaml)
python -m bigboard --replay fixtures/demo-events.jsonl --speed 20
python -m bigboard --check --events <file>           # headless: parse, fold,
                                                           # summarize, exit 0/1
```

`--check` is the scriptable smoke test — CI-friendly, and handy over SSH when you
just want "is anything stuck?" without the UI.

## How it stays decoupled

Three rules, enforced by `scripts/verify.sh`:

1. Only the contract: events stream, snapshot CLI, `runs/` and `.loop/` paths that
   events point to.
2. Never `import blacksun.*` (grepped on every verify).
3. Unknown event kinds render raw instead of crashing — the stream may grow
   (additively, within `v: 1`) without the console needing a release.

## Development

```sh
make test     # offline: fixtures + fakes, no blacksun, no network
make lint
make verify   # spec.md §8 — includes running black-sun's own verifies
```

The spec that built this is [spec.md](spec.md); decisions made along the way are
in [DECISIONS.md](DECISIONS.md).
