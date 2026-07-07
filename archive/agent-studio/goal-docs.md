# Goal prompt for /goal — the docs build

Run from the repo root: `/goal "$(sed '1,/^---$/d' agent-studio/goal-docs.md)"`

---
Write the Agent Studio documentation set specified in
`/Users/jorgeper/src/sandbox/agent-studio/docs-spec.md`, working only inside
`/Users/jorgeper/src/sandbox/agent-studio/`.

GOAL (the only exit condition): `./scripts/verify-docs.sh` exits 0, implementing
exactly the 9 acceptance criteria in docs-spec.md §6, AND `make verify` still exits 0
(13/13). Do not weaken either script; strengthening is allowed. Do not stop or declare
success before both are green.

Read first, once: docs-spec.md end to end; then spec.md, both files in research/, and
agentic-engineering-field-guide.md (these are the source material for Part 1); then the
actual source under studio/ before writing anything that describes it — every factual
claim about the system must be verified against code, and every example command must be
one you actually ran (run `make demo` and quote its real output where the docs show
output).

How to work — hill-climb:
1. Write scripts/verify-docs.sh and scripts/check_links.py FIRST, from §6. Run them;
   record the failing-check count. It must only ever decrease.
2. Build in order: docs/README.md skeleton → Part 1 (concepts) → Part 2 (architecture)
   → Part 3 (guide) → Part 4 (labs, including the three NEW labs) → reorganization
   glue (old architecture.md signpost or verify.sh path update; root README section).
3. One commit per part: `docs(studio): part N — <name>`. Run verify-docs.sh before
   every commit and append the score to PROGRESS.md.
4. Diagram-first: draft each Part 1–2 doc's Mermaid diagram BEFORE its prose; keep to
   graph/sequenceDiagram/stateDiagram-v2, ≤15 nodes, labeled edges.
5. Self-review each part as a stranger before its commit: does the diagram teach
   without the text? does every cross-link land? would you cut any paragraph? Cut it.
6. Record judgment calls in DECISIONS.md, one line each. Never block on a human.

Quality bar (docs-spec §1 is binding): teach-then-show with real repo examples; no
filler or throat-clearing; guides 80–250 lines; concepts docs cite ≥2 sources inline;
labs have copy-pasteable numbered commands, expected checkpoint output, and a "What
you learned" close.

Stop rules: same failing check 10 consecutive attempts with no progress → BLOCKED
report in PROGRESS.md, commit, stop. No network needed except nothing — all sources
are in-repo; treat any urge to browse the web as scope creep.

Hard boundaries: never touch files outside agent-studio/ (repo root is the parent
sandbox/; stage only agent-studio paths). Never git push. Do not modify studio/
source code except: verify.sh check-9 path maintenance if docs move, and the lab-06
tracker stub + its test which docs-spec §6.9 requires. Do not modify spec.md or
docs-spec.md except to fix an internal contradiction (record it, quoted, in
DECISIONS.md).

When both scripts first exit 0: run each twice more back-to-back; re-read
docs/README.md and one doc per part as a stranger and fix what jars; commit
`docs(studio): final — verify-docs green`; write the final summary in PROGRESS.md
(scores, commit list, the three docs a human should proofread first). Then stop.
