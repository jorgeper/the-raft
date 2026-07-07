# Studio Console — Specification

Two deliverables, deliberately decoupled:

- **Part A — Observability in Agent Studio** (`../agent-studio/`): a versioned,
  file-based event stream plus machine-readable snapshot commands. Agent Studio
  gains a public observability *contract*; it neither knows nor cares who consumes it.
- **Part B — Studio Console** (this folder): a modern terminal app (Textual + Rich)
  that consumes ONLY that contract: live dashboard of running agents, formatted
  agent output, GoalLoop progress, and a browsable backlog.

The finish line is §8, checked by `./scripts/verify.sh` **in this folder** (it also
re-runs Agent Studio's own `verify.sh` and `verify-docs.sh` — no regressions).

## 1. Design principles

- **The contract is files + CLI, not imports.** The console never imports `studio.*`
  and never reads tracker internals (`.work/`, labels). It consumes exactly four
  documented interfaces (§2). Either side can be rewritten without breaking the other.
- **Read-only console.** v1 observes; it never mutates studio state (no approve, no
  transition — v2 territory, see §7).
- **Append-only JSONL events**, in the spirit of the existing audit log: greppable,
  tail-able, no server, works over SSH.
- **Console must be developable offline**: a committed fixture stream + replay mode
  mean zero Agent Studio (and zero API keys) needed for console work and tests.

## 2. The observability contract (Part A's public interface)

1. **Event stream** — `<studio-root>/.agent-logs/events.jsonl`. One JSON object per
   line; file append order is canonical (the `seq` field is per-writer advisory).
   Schema §3, version field `v: 1`. Rotation: writer renames to `events.jsonl.1` at
   ~10MB; consumers must survive truncation/rotation by reopening.
2. **Snapshot commands** (machine-readable, stable):
   - `python -m studio status --json` → `{"generated": ts, "items": [{id, title,
     state, kind, claimed_by, updated, url}]}`
   - `python -m studio show <id> --json` → the full item incl. `comments:
     [{author, body}]` (new command; also gets a human-readable non-JSON form).
3. **Run artifacts** — the existing `runs/<stamp>-<item>-<agent>/{prompt.md,
   output.md}` layout, now guaranteed by the contract doc (events carry `run_dir`
   pointers).
4. **Loop files** — the existing worktree `.loop/{plan.json,progress.md,
   guardrails.md}` layout; `loop_start` events carry the `workdir` pointer.

The contract is documented in
`../agent-studio/docs/architecture/07-observability.md` (added to the book index;
extend verify-docs.sh's ARCH manifest to include it — strengthening is allowed).

## 3. Event schema (v1)

Envelope: `{"v": 1, "seq": <int>, "ts": "<iso8601-utc>", "kind": "<kind>",
"item": "<id|null>", "agent": "<name|null>", "data": {...}}`.
Text excerpts in `data` are tails, capped: `output_tail`/`comment_tail` ≤ 2000
chars, `gate_tail` ≤ 1000. Full text always lives in the pointed-at files.

| kind | emitted by | data |
|---|---|---|
| `tick_start` / `tick_end` | orchestrator | `{n}` / `{n, dispatched, skipped}` |
| `dispatch_start` | orchestrator | `{shape: commenter\|coder\|review-round}` |
| `dispatch_end` | orchestrator | `{action, detail}` |
| `runtime_start` | orchestrator/loop | `{runtime, run_dir, prompt_chars}` |
| `runtime_end` | orchestrator/loop | `{exit_code, duration_s, output_tail}` |
| `loop_start` | GoalLoop | `{workdir, max_iterations, max_minutes, tasks_total, tasks_passed}` |
| `iteration_start` | GoalLoop | `{n, task_id, task_title}` (task null in planning/confirmation) |
| `gate_result` | GoalLoop | `{command, ok, gate_tail}` |
| `task_passed` | GoalLoop | `{task_id, tasks_passed, tasks_total}` |
| `guardrail_added` | GoalLoop | `{trigger}` |
| `loop_exit` | GoalLoop | `{reason, iterations, wall_time_s}` |
| `item_created` | tracker | `{title, kind, state}` |
| `transition` | tracker | `{from, to, actor}` |
| `comment_added` | tracker | `{author, chars, comment_tail}` |
| `claimed` / `released` | tracker | `{agent}` |

Implementation: `studio/events.py` — `EventLog` (append, fsync-less, rotation) and
`NullEventLog`; constructor-injected into Orchestrator, GoalLoop, and trackers (via
`make_tracker`), defaulting to a real log under `cfg.root`. The demo emits real
events; `studio demo --keep` preserves its sandbox and prints the path (this is how
the committed console fixture gets regenerated). Multi-process note: `--watch` plus
a concurrent CLI command may interleave writes; line-level appends of <4KB are
atomic enough on POSIX — document, don't engineer around.

Part A tests (in agent-studio's suite): schema envelope validation; emission at
every point in the table (orchestrator dispatch, loop lifecycle incl. gate_result
and guardrail_added, tracker transitions/comments/claims); tails capped; rotation;
`status --json`/`show --json` round-trip through the real MarkdownTracker; demo's
event stream contains a coherent lifecycle sequence (created → transitions →
loop_start → … → loop_exit → done).

## 4. The console app (Part B)

Stack: Python ≥ 3.11, **Textual** (app framework) + **Rich** (rendering), PyYAML.
Dev deps: pytest, pytest-cov, ruff, pytest-asyncio if needed by Textual's pilot.
Own venv, own Makefile (`make run / demo / test / lint / verify`), own README.

```
studio-console/
├── spec.md  goal.md  README.md  pyproject.toml  Makefile
├── studio_console/
│   ├── __init__.py  app.py            # Textual App, screens, keybindings
│   ├── events.py                      # event dataclasses + parser (v-check, unknown-kind tolerant)
│   ├── tailer.py                      # EventTailer: poll/tail JSONL, survive rotation+truncation
│   ├── snapshot.py                    # board/item snapshots via `studio ... --json` (subprocess seam)
│   ├── state.py                       # ConsoleState: fold events+snapshots into one queryable model
│   ├── replay.py                      # replay a fixture stream (--speed), and --check mode
│   └── widgets/                       # feed, board, item detail, loop panel, runs browser
├── fixtures/demo-events.jsonl         # committed; regenerated via `studio demo --keep`
├── fixtures/demo-status.json          # committed snapshot fixture
├── scripts/verify.sh                  # THE finish line (§8)
├── config.yaml                        # studio_root, studio_python, poll intervals
└── tests/
```

### Screens and layout (keybindings: `1-4` screens, `q` quit, `?` help)

**1 · Dashboard** (default) — header: counts by state + active-agent count; left:
**Active now** (each running dispatch: agent, item, shape, elapsed timer; for loops
a task progress bar `tasks_passed/tasks_total` and current iteration); right:
**Event feed** — latest events, newest on top, one line each with kind-specific
icon/color, expandable (enter) to show the full tail nicely formatted.

```
┌ studio-console ── backlog 2 · specs 1 · coding 1 · review 1 · needs-you 2 ────┐
│ ACTIVE NOW                        │ EVENTS                                    │
│ ▶ coder      #4  GoalLoop  03:12  │ 12:01:44 ✔ gate_result  pytest -q  ok     │
│   iter 3/10  tasks ▮▮▮▯▯ 3/5      │ 12:01:40 ⚙ iteration_start #4 t4          │
│ ▶ reviewer-a #2  review    00:41  │ 12:01:12 ✚ comment_added #2 reviewer-b    │
│                                   │ 12:00:58 ⇢ transition #2 → pr:agent-review│
└───────────────────────────────────┴───────────────────────────────────────────┘
```

**2 · Board** — items grouped by state in pipeline order, arrow-key navigation,
`enter` opens Item detail. States color-coded to match the GitHub label scheme
(red = needs you). A "Needs you" strip pinned on top.

**3 · Item detail** — title/state/kind/claim header; the comment thread rendered as
Markdown (Rich), color-tagged by author role; a state-history timeline folded from
`transition` events; if a loop ran: link/keystroke (`l`) to the Loop panel showing
plan tasks with pass/fail marks, gate results, and guardrails.

**4 · Runs** — browsable list of `runs/<stamp>-<item>-<agent>/`; viewer renders
`prompt.md`/`output.md` as Markdown with scroll.

### Data flow

`EventTailer` polls the stream (250ms) → parsed events fold into `ConsoleState`
(counts, active dispatches with start-times, per-item timelines, loop progress) →
Textual reactive updates. Snapshots refresh the board every 5s *and* on any
`transition`/`item_created` event. All subprocess calls go through one injected
seam (mirroring agent-studio's `CommandExecutor`) so tests fake them. Unknown event
kinds are shown raw, never crash (forward compatibility); `v != 1` shows a banner.

### Modes

- `make run` / `python -m studio_console` — live, against `config.yaml`'s studio root.
- `--replay fixtures/demo-events.jsonl [--speed 20]` — replays with timing; this is
  `make demo` (works with zero Agent Studio installed).
- `--check [--events <file>]` — headless: parse the stream, fold state, print a
  summary (counts, last event, active loops), exit 0/1. This is the scriptable
  smoke test used by verify.sh and the integration check.

### Part B tests (all offline)

Parser (every §3 kind + unknown-kind tolerance + v-mismatch), tailer (append,
rotation, truncation mid-line), state folding (active-dispatch pairing
start/end, loop progress from task_passed, needs-you derivation), snapshot
(subprocess seam faked, JSON parsed), replay/check (fixture → expected summary),
and Textual pilot smoke tests: app boots headless on the fixture, dashboard shows
expected agent names, board navigation reaches an item detail. Coverage ≥ 75%.

## 5. Documentation

- `README.md` here: what it is, screenshot-style ASCII of the dashboard, install
  (`uv venv` + deps), `make demo` first (fixture replay — no studio needed), then
  pointing at a real studio (`config.yaml`), keybindings table, the contract it
  consumes (link to agent-studio's architecture/07). A newcomer: clone → `make
  demo` → moving dashboard in under 5 minutes.
- `../agent-studio/docs/architecture/07-observability.md`: the contract (schema
  table, snapshot commands, pointers, rotation, versioning policy: additive within
  v1, `v` bump on breaking change) + one line in the book index. Keep the book's
  standards: opening diagram, nav footer, ≥80 lines.

## 6. Milestones (commit after each)

1. **O1** Part A: events.py + orchestrator/loop/tracker emission + tests green.
2. **O2** Part A: `status --json`, `show <id> --json`, demo `--keep`, contract doc;
   agent-studio verify.sh 13/13 + verify-docs.sh green (with 07 added to manifest).
3. **C1** Console skeleton: pyproject, venv, parser, tailer, state, `--check`,
   fixtures (regenerated from a real `studio demo --keep` run), tests.
4. **C2** Dashboard + event feed (replay mode working = `make demo`).
5. **C3** Board + item detail + loop panel.
6. **C4** Runs browser, polish (colors, help screen), README.
7. **C5** verify.sh assembles everything; fix what it finds; green.

## 7. Out of scope (v1)

Actions from the console (approve/re-route — v2, and it will go through the
`studio` CLI, not tracker files), web UI, metrics/cost dashboards, notifications,
multi-studio aggregation, Windows terminals (POSIX only, like the rest).

## 8. Acceptance criteria — `./scripts/verify.sh` (exit 0 = done)

1. `ruff check .` clean (console) and console pytest green, ≥ 20 tests, coverage of
   `studio_console/` ≥ 75%.
2. `python -m studio_console --check --events fixtures/demo-events.jsonl` exits 0
   and its summary names ≥ 3 distinct agents and a completed lifecycle (an item
   reaching `done`).
3. Replay smoke: a pilot-driven test proves the app boots on the fixture and the
   dashboard renders expected content (verify.sh confirms the test exists and ran).
4. Integration, live: run agent-studio's demo (`--keep`), then `--check` against
   the *freshly produced* events file — exits 0 and sees a `loop_exit` with reason
   `verified` and a `transition` to `done`.
5. Snapshot contract: `python -m studio status --json` and `show 1 --json` (run in
   the kept demo sandbox or a temp markdown-tracker studio) parse as valid JSON
   with the §2 fields — asserted by a script/test, not eyeballed.
6. Agent-studio regressions: `../agent-studio/scripts/verify.sh` exits 0 AND
   `../agent-studio/scripts/verify-docs.sh` exits 0 (with architecture/07 in its
   manifest).
7. Part A emission tests exist and pass in agent-studio's suite (verify.sh greps
   for `test_events` and runs agent-studio's pytest).
8. Files exist and are non-trivial: README.md here (>60 lines, includes keybindings
   and the demo path), `docs/architecture/07-observability.md` in agent-studio
   (>80 lines, in the book index), `fixtures/demo-events.jsonl` (≥ 40 events,
   ≥ 8 distinct kinds).
9. Hygiene: no TODO/TBD/FIXME under studio_console/ or the new docs; the console
   never imports `studio.` (grepped) — the decoupling is checked, not hoped for.
