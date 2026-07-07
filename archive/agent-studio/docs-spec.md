# Docs Spec — the Agent Studio book

The contract for an autonomous docs-writing loop. Deliverable: a documentation set
under `docs/` good enough that a developer who has never heard of loop engineering
finishes it understanding (1) the discipline, (2) this system's architecture, and
(3) how to run it daily — and has done six hands-on labs. The finish line is §6,
checked by `./scripts/verify-docs.sh`.

## 1. Audience, voice, and quality bar

- Reader: a working developer, comfortable with git/Python/CLIs, new to agentic
  loops. No AI background assumed; no hand-waving tolerated.
- Voice: teach-then-show. Every concept lands with a concrete example from THIS
  repo — a real command, a real file, real output from `make demo`. Every claim
  about the system must be checked against the actual source before it is written
  (read `studio/`, don't guess).
- **Diagram-first**: each part-1 and part-2 doc opens with a Mermaid diagram that a
  reader could re-draw from memory afterwards. Use `graph TD/LR`,
  `sequenceDiagram`, and `stateDiagram-v2` only (GitHub renders these). Simple
  beats ornate: max ~15 nodes per diagram; label edges.
- Length discipline: guides 80–250 lines each. If a doc wants to be longer, it's
  two docs. No filler, no "In this guide we will…" throat-clearing.
- Sources: part-1 docs cite at least two sources each (the field guide, the
  research reports, or the original URLs inside them), as inline links.

## 2. Structure manifest (every file required)

```
docs/
├── README.md                              # index: the learning path, part synopses, how to read
├── concepts/                              # PART 1 — loop engineering, the discipline
│   ├── 01-from-prompts-to-loops.md        # the leverage shift; Osmani's 6 components; autonomy slider
│   ├── 02-anatomy-of-a-harness.md         # model vs harness; intent/harness/environment enforcement
│   ├── 03-the-ralph-loop.md               # fresh context + durable files; plan queues; one-task-per-iteration; lineage (Huntley → /goal)
│   ├── 04-verification-is-the-bottleneck.md  # Karpathy's thesis; maker/checker; harness-owned completion; gates
│   └── 05-autonomy-and-safety.md          # earned autonomy; stop rules; budgets; what loops never absorb (your judgment)
├── architecture/                          # PART 2 — how THIS system is built
│   ├── 01-system-overview.md              # the full map (absorbs old docs/architecture.md); one lifecycle sequenceDiagram
│   ├── 02-state-machine.md                # states, actors, human gates; stateDiagram-v2; why enforcement is code
│   ├── 03-trackers-and-work-items.md      # Tracker ABC; markdown vs github; claims; the board
│   ├── 04-agents-skills-runtimes.md       # the agent bundle; SKILL.md; native subagents vs inlining; adding agents/skills/runtimes
│   ├── 05-goal-loop-internals.md          # THE deep dive: iteration protocol, plan reconcile, feedback, guardrails, ratchet, circuit breaker, exit codes — with a flowchart of one iteration
│   └── 06-orchestrator-and-safety.md      # ticks, claims, review rounds, degraded mode; hooks/permissions; the three enforcement layers applied
├── guide/                                 # PART 3 — operating it
│   ├── 01-install-and-first-run.md        # prerequisites → make demo → reading the demo output line by line
│   ├── 02-daily-workflow.md               # the human's day: status, the two gates, reading PRs, journals; a "day in the life"
│   ├── 03-configuration.md                # studio.yaml reference: every key, default, and when to change it
│   ├── 04-going-live-on-github.md         # labels, tokens, target_repo, first real item; links deploy/vps.md for 24/7
│   └── 05-troubleshooting.md              # reading runs/ and .loop/; common failures (thrash, escalation, degraded review, config errors) and what each means
└── labs/                                  # PART 4 — hands-on
    ├── 01-build-an-app.md                 # existing — keep, re-link to the new index
    ├── 02-add-a-feature.md                # existing — keep
    ├── 03-fix-a-bug.md                    # existing — keep
    ├── 04-watch-the-loop-save-itself.md   # NEW: sabotage lab — plant a failing gate offline (FakeRuntime or demo fork), watch feedback injection, the guardrail appear at 3 strikes, the circuit breaker trip, the escalation comment
    ├── 05-teach-the-team.md               # NEW: memory + skills — seed journals, add a house rule via AGENTS.md proposal, write a new skill and wire it to an agent, prove it lands in the prompt (runs/)
    └── 06-extend-the-studio.md            # NEW: add a third reviewer agent (security lens) end to end; sketch + stub a Linear tracker against the Tracker ABC with a passing test
```

Rules for the reorganization:

- Old `docs/architecture.md` is ABSORBED into `architecture/*` and then replaced by
  a short (>40-line) signpost page at the same path — or verify.sh's check-9 file
  list is updated to the new paths. Either way `make verify` must stay 13/13; path
  maintenance is allowed, weakening checks is not.
- Old labs stay at `docs/labs/` (same filenames), updated only for links/navigation.
- Root `README.md` gains a "Documentation" section linking to `docs/README.md`.

## 3. Per-doc requirements

- Front of every doc: one-line purpose in italics, then (parts 1–2) the opening
  diagram.
- End of every doc: a `---` rule then prev/next navigation links plus a link to
  `docs/README.md`.
- Labs: numbered steps, every command copy-pasteable, expected output shown for the
  checkpoints, and a closing "What you learned" section (3–5 bullets).
- Cross-linking is a feature: when a concept doc mentions a mechanism, link the
  architecture doc; when an architecture doc mentions usage, link the guide.
- Code references as `studio/loop.py:_verify`-style paths so readers can jump in.

## 4. Diagram requirements (minimums)

- ≥ 15 Mermaid diagrams total under docs/.
- Specifically required: lifecycle sequenceDiagram (architecture/01), full
  stateDiagram-v2 (architecture/02), GoalLoop single-iteration flowchart
  (architecture/05), enforcement-layers diagram (architecture/06 or concepts/02),
  autonomy-slider or components diagram (concepts/01).
- Every ```mermaid fence non-empty, balanced, and using only the three allowed
  diagram types.

## 5. Process requirements

- Read before writing: spec.md, the two research/ reports, the field guide, and the
  actual source of any module a doc describes.
- Write `scripts/verify-docs.sh` FIRST (it is small), then write docs to green.
- One commit per part (`docs(studio): part N — <name>`), plus one for the
  verify-docs script and one final.

## 6. Acceptance criteria — checked by `./scripts/verify-docs.sh` (exit 0 = done)

1. Every file in the §2 manifest exists; guides ≥ 80 lines, labs ≥ 60, index ≥ 40.
2. ≥ 15 non-empty, balanced ```mermaid blocks under docs/; the five specifically
   required diagrams exist in their named docs (grep for `sequenceDiagram` in
   architecture/01, `stateDiagram` in architecture/02, etc.).
3. Link integrity: every relative markdown link under docs/ (and the root README's
   docs links) resolves to an existing file — checked by a small Python script the
   loop writes (scripts/check_links.py), invoked from verify-docs.sh.
4. docs/README.md links to every manifest file; every doc ends with navigation
   links (grep for a link to `README.md` or `../README.md` in each).
5. Hygiene: zero occurrences of TODO, TBD, FIXME, lorem, or `agentic-harness`
   under docs/.
6. Each concepts/ doc contains ≥ 2 markdown links to sources (field guide,
   research/, or http links).
7. Each lab contains a "What you learned" section.
8. `make verify` still exits 0 — the docs work must not regress the system.
9. `python -m pytest` still green (lab 06's tracker-stub test is added, not mocked
   into existence — it must actually pass).
