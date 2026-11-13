# Streaming Agent Output — Spec Addendum

Extends the observability contract (spec.md, agent-studio docs/architecture/07) so
you can watch each agent's output *while it runs*, not just at invocation
boundaries. Additive within event-schema v1 — existing consumers keep working.
Finish line: §6, checked by the strengthened `./scripts/verify.sh` (old 9 checks
ratchet: they must all still pass).

## 1. The new event kind

| kind | emitted by | data |
|---|---|---|
| `agent_output` | orchestrator / loop, during a runtime invocation | `{chunk, channel, done}` |

- `chunk`: a coalesced piece of the agent's incremental output (cap 2000 chars via
  a new `chunk` entry in TAIL_CAPS).
- `channel`: `"text"` (assistant prose) or `"tool"` (a one-line tool-use notice,
  e.g. ``tool: Bash `pytest -q` ``).
- `done`: true on the final flush of an invocation.

**Coalescing is mandatory.** Raw deltas would flood the stream: an `OutputCoalescer`
(in `studio/events.py`) buffers and flushes when ≥400 chars accumulate or ≥1.0s has
passed since the last flush (injectable clock), plus a final flush. A 5-minute
invocation should produce tens of `agent_output` events, not thousands.

## 2. Runtime streaming (Part A, agent-studio)

- `CommandExecutor` gains `stream(argv, *, cwd, timeout_s, on_line) -> CommandResult`
  (Popen, line-buffered stdout → `on_line` per line, stderr captured; result carries
  full stdout as today). `FakeExecutor` gains scripted stream lines.
- `ModelRuntime.run` gains optional `on_output: Callable[[str, str], None] | None`
  (args: chunk, channel). Default None = exactly today's behavior.
- **ClaudeCodeRuntime**: when `on_output` is set, invoke with
  `--output-format stream-json` (plus whatever flag it requires alongside `-p` —
  VERIFY the exact format against current Claude Code docs at build time, e.g. via
  context7; some versions require `--verbose`). Parse each JSON line: assistant
  text deltas → `on_output(text, "text")`; tool-use blocks → one-line notice →
  `on_output(..., "tool")`; the `result` line supplies RuntimeResult.output.
  Unknown line types are skipped silently (their format may evolve).
- **CodexRuntime**: generic fallback — stream raw stdout lines as `"text"` chunks.
- **FakeRuntime**: scripted responses may be `(final_text, [chunks])` tuples, or
  callables may accept an optional second `on_output` argument — so the demo and
  tests can stream.
- Config: `runtimes.<name>.streaming: true|false`, default true for kind=claude,
  false otherwise (codex opt-in). Non-streaming runtimes simply emit no
  `agent_output` — consumers already tolerate absence.

Wiring: `Orchestrator._invoke` and the GoalLoop's runtime call pass an `on_output`
that feeds an OutputCoalescer whose flushes emit `agent_output` (bound item/agent,
as today). The demo streams a few chunks per scripted agent; regenerate BOTH
fixtures from a real `studio demo --keep` run afterwards. Contract doc 07 gains the
new kind's row and a coalescing note (verify-docs stays green).

## 3. Console (Part B)

- `agent_output` joins KNOWN_KINDS; ConsoleState keeps a rolling per-item output
  buffer on the ActiveDispatch (last ~4000 chars; dropped on dispatch_end).
- **Dashboard gains a live-output pane** (bottom, full width): the streaming text
  of the most recently active agent, dim-styled, last ~12 lines, with a
  `▶ agent #item (channel)` caption. Empty state: "no live output".
- **The feed excludes `agent_output` by default** (it would drown everything);
  key `o` toggles them in/out. All other screens unchanged.
- Tests: coalesced folding into the buffer, pane renderable, feed filtering +
  toggle, and the pilot smoke extended to assert live output text appears on the
  dashboard when replaying the (regenerated) fixture.

## 4. Milestones

S1 executor.stream + runtime streaming + tests → S2 coalescer + wiring + demo/
fixtures + doc 07 update → S3 console state/pane/filter + tests → S4 verify green.
One commit each (`feat(stream): S<n> ...`).

## 5. Out of scope

Streaming *thinking* blocks; per-iteration output history (only the live buffer);
backfilling old fixtures; codex JSON parsing (raw lines suffice).

## 6. Acceptance — appended to `scripts/verify.sh` as checks 10–12

10. **Streaming unit proof:** agent-studio has `tests/test_streaming.py` covering:
    executor.stream line delivery; ClaudeCodeRuntime parsing a recorded
    stream-json sample (checked into agent-studio tests/data/) incl. skipping an
    unknown line type; coalescer flush-by-size, flush-by-time (fake clock), and
    final `done` flush — and agent-studio's full pytest stays green.
11. **Contract proof, live:** the fresh-demo integration (existing check 4's
    sandbox) additionally contains ≥3 `agent_output` events with non-empty
    `chunk`, at least one `"done": true`, and doc 07 lists `agent_output`;
    regenerated `fixtures/demo-events.jsonl` contains them too.
12. **Console proof:** console tests cover buffer folding + feed filtering; the
    pilot test asserts streamed text renders in the dashboard's live pane; checks
    1–9 all still pass (the ratchet).
