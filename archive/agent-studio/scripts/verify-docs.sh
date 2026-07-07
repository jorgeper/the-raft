#!/usr/bin/env bash
# Finish line for the docs build — implements docs-spec.md §6 exactly.
# Exits 0 only when all 9 checks pass. Strengthening allowed; weakening is not.
set -u
cd "$(dirname "$0")/.."
PY="${PYTHON:-$(pwd)/.venv/bin/python}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
RESULTS=()
check() {
  if [ "$2" -eq 0 ]; then RESULTS+=("✅ $1"); PASS=$((PASS + 1)); else RESULTS+=("❌ $1"); FAIL=$((FAIL + 1)); fi
}

CONCEPTS="docs/concepts/01-from-prompts-to-loops.md docs/concepts/02-anatomy-of-a-harness.md docs/concepts/03-the-ralph-loop.md docs/concepts/04-verification-is-the-bottleneck.md docs/concepts/05-autonomy-and-safety.md"
ARCH="docs/architecture/01-system-overview.md docs/architecture/02-state-machine.md docs/architecture/03-trackers-and-work-items.md docs/architecture/04-agents-skills-runtimes.md docs/architecture/05-goal-loop-internals.md docs/architecture/06-orchestrator-and-safety.md"
GUIDE="docs/guide/01-install-and-first-run.md docs/guide/02-daily-workflow.md docs/guide/03-configuration.md docs/guide/04-going-live-on-github.md docs/guide/05-troubleshooting.md"
LABS="docs/labs/01-build-an-app.md docs/labs/02-add-a-feature.md docs/labs/03-fix-a-bug.md docs/labs/04-watch-the-loop-save-itself.md docs/labs/05-teach-the-team.md docs/labs/06-extend-the-studio.md"

# --- 1. manifest + minimum substance -----------------------------------------
C1=0
for f in $CONCEPTS $ARCH $GUIDE; do
  if [ ! -f "$f" ] || [ "$(wc -l <"$f")" -lt 80 ]; then C1=1; echo "  guide short/missing: $f" >>"$TMP/c1"; fi
done
for f in $LABS; do
  if [ ! -f "$f" ] || [ "$(wc -l <"$f")" -lt 60 ]; then C1=1; echo "  lab short/missing: $f" >>"$TMP/c1"; fi
done
[ -f docs/README.md ] && [ "$(wc -l <docs/README.md)" -ge 40 ] || C1=1
check "1. manifest complete; guides>=80, labs>=60, index>=40 lines" "$C1"

# --- 2. mermaid: >=15 blocks, balanced fences, the five required diagrams ----
C2=0
TOTAL_MERMAID=0
for f in $CONCEPTS $ARCH $GUIDE $LABS docs/README.md; do
  [ -f "$f" ] || continue
  n=$(grep -c '^```mermaid' "$f" || true)
  TOTAL_MERMAID=$((TOTAL_MERMAID + n))
  fences=$(grep -c '^```' "$f" || true)
  [ $((fences % 2)) -eq 0 ] || { C2=1; echo "  unbalanced fences: $f" >>"$TMP/c2"; }
done
[ "$TOTAL_MERMAID" -ge 15 ] || { C2=1; echo "  only $TOTAL_MERMAID mermaid blocks (<15)" >>"$TMP/c2"; }
grep -q 'sequenceDiagram' docs/architecture/01-system-overview.md 2>/dev/null || C2=1
grep -q 'stateDiagram' docs/architecture/02-state-machine.md 2>/dev/null || C2=1
grep -Eq 'graph |flowchart ' docs/architecture/05-goal-loop-internals.md 2>/dev/null || C2=1
{ grep -q '```mermaid' docs/concepts/02-anatomy-of-a-harness.md 2>/dev/null ||
  grep -q '```mermaid' docs/architecture/06-orchestrator-and-safety.md 2>/dev/null; } || C2=1
grep -q '```mermaid' docs/concepts/01-from-prompts-to-loops.md 2>/dev/null || C2=1
check "2. mermaid: $TOTAL_MERMAID blocks (>=15), balanced, five required diagrams present" "$C2"

# --- 3. link integrity --------------------------------------------------------
"$PY" scripts/check_links.py >"$TMP/links.out" 2>&1
check "3. every relative link under docs/ and root README resolves" $?

# --- 4. navigation: index links all docs; every doc links back ----------------
C4=0
for f in $CONCEPTS $ARCH $GUIDE $LABS; do
  base=$(basename "$f")
  grep -q "$base" docs/README.md || { C4=1; echo "  index missing link: $base" >>"$TMP/c4"; }
  grep -q 'README.md' "$f" 2>/dev/null || { C4=1; echo "  no nav back-link: $f" >>"$TMP/c4"; }
done
check "4. docs/README.md links every doc; every doc links back to the index" "$C4"

# --- 5. hygiene ----------------------------------------------------------------
if grep -rEn 'TODO|TBD|FIXME|lorem|agentic-harness' docs/ >"$TMP/c5" 2>/dev/null; then C5=1; else C5=0; fi
check "5. no TODO/TBD/FIXME/lorem/agentic-harness anywhere under docs/" "$C5"

# --- 6. concepts cite sources ---------------------------------------------------
C6=0
for f in $CONCEPTS; do
  n=$(grep -oE '\]\(([^)]*)(field-guide|research/|http)[^)]*\)' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" -ge 2 ] || { C6=1; echo "  <2 source links: $f" >>"$TMP/c6"; }
done
check "6. every concepts doc cites >=2 sources inline" "$C6"

# --- 7. labs close with What you learned ----------------------------------------
C7=0
for f in $LABS; do
  grep -q '## What you learned' "$f" 2>/dev/null || { C7=1; echo "  missing: $f" >>"$TMP/c7"; }
done
check "7. every lab has a 'What you learned' section" "$C7"

# --- 8. the system itself is still green ----------------------------------------
./scripts/verify.sh >"$TMP/verify.out" 2>&1
check "8. make verify still exits 0 (13/13 — no regression)" $?

# --- 9. tests still green (incl. lab-06 tracker stub's test) --------------------
"$PY" -m pytest -q >"$TMP/pytest.out" 2>&1 &&
  grep -q 'def test_' tests/test_tracker_linear.py 2>/dev/null
check "9. pytest green including the lab-06 Linear tracker stub test" $?

echo
echo "Agent Studio docs verification — docs-spec.md §6"
echo "-------------------------------------------------"
for line in "${RESULTS[@]}"; do echo "$line"; done
echo "-------------------------------------------------"
echo "score: $PASS/9"
if [ "$FAIL" -gt 0 ]; then
  echo "details:"
  cat "$TMP"/c* "$TMP/links.out" 2>/dev/null | grep -v '^check_links: .* 0 broken' | head -40
fi
[ "$FAIL" -eq 0 ]
