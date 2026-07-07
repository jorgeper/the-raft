#!/usr/bin/env bash
# THE FINISH LINE — implements spec.md §17 exactly. Exits 0 only when all 13 pass.
# Strengthening these checks is allowed; weakening them is not.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PY="${PYTHON:-$ROOT/.venv/bin/python}"
RUFF="${RUFF:-$ROOT/.venv/bin/ruff}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
RESULTS=()

check() { # $1: number+description, $2: 0=pass nonzero=fail
  if [ "$2" -eq 0 ]; then
    RESULTS+=("✅ $1")
    PASS=$((PASS + 1))
  else
    RESULTS+=("❌ $1")
    FAIL=$((FAIL + 1))
  fi
}

# --- 1. ruff clean -----------------------------------------------------------
"$RUFF" check . >"$TMP/ruff.out" 2>&1
check "1. ruff check . clean" $?

# --- 2 + 3. pytest green, >=25 tests, coverage >=80% -------------------------
# (pyproject addopts already has -q; adding another would hide the summary line)
"$PY" -m pytest --cov=studio --cov-report=term --cov-fail-under=80 >"$TMP/pytest.out" 2>&1
PYTEST_RC=$?
COLLECTED=$(grep -Eo '^[0-9]+ passed' "$TMP/pytest.out" | grep -Eo '^[0-9]+' || echo 0)
[ "$PYTEST_RC" -eq 0 ] || COV_FAIL=1
grep -q 'FAILED\|ERROR' "$TMP/pytest.out" && TESTS_FAIL=1
check "2. pytest green with >=25 tests (got: $COLLECTED)" \
  "$([ "${TESTS_FAIL:-0}" -eq 0 ] && [ "$COLLECTED" -ge 25 ]; echo $?)"
check "3. coverage of studio/ >= 80%" "$PYTEST_RC"

# --- 4. demo reaches done, with a changes-requested cycle --------------------
PYTHON="$PY" ./scripts/demo.sh >"$TMP/demo.out" 2>&1
DEMO_RC=$?
grep -q 'pr:changes-requested' "$TMP/demo.out" && grep -q 'state: done' "$TMP/demo.out"
DEMO_STATES=$?
check "4. demo.sh exits 0, item reaches done via a changes-requested cycle" \
  "$([ "$DEMO_RC" -eq 0 ] && [ "$DEMO_STATES" -eq 0 ]; echo $?)"

# --- 5. orchestrator dry-run -------------------------------------------------
"$PY" -m studio run --dry-run --once >"$TMP/dryrun.out" 2>&1
check "5. studio run --dry-run --once exits 0" $?

# --- 6. status renders a board ----------------------------------------------
"$PY" -m studio status >"$TMP/status.out" 2>&1 && grep -qi 'state\|board\|item' "$TMP/status.out"
check "6. studio status exits 0 and renders a board" $?

# --- 7. config sanity tests exist and pass -----------------------------------
grep -q 'def test_unknown_state_fails' tests/test_config.py &&
  grep -q 'def test_missing_prompt_file_fails' tests/test_config.py &&
  grep -q 'def test_default_config_loads' tests/test_config.py &&
  "$PY" -m pytest -q tests/test_config.py >"$TMP/cfg.out" 2>&1
check "7. config sanity: default loads; unknown state / missing prompt fail clearly" $?

# --- 8. human-only transitions reject agent actors ---------------------------
grep -q 'def test_human_only_transitions_reject_agent_actor' tests/test_state.py &&
  "$PY" -m pytest -q tests/test_state.py >"$TMP/state.out" 2>&1
check "8. state machine: human-only transitions reject agent actors (tested)" $?

# --- 9. docs/prompts/skills exist and are non-trivial ------------------------
FILES_OK=0
for f in README.md docs/architecture.md docs/labs/01-build-an-app.md \
  docs/labs/02-add-a-feature.md docs/labs/03-fix-a-bug.md deploy/vps.md \
  prompts/prd.md prompts/architect.md prompts/coder.md prompts/reviewer.md \
  .claude/settings.json .claude/hooks/guard.sh .claude/hooks/audit.sh AGENTS.md; do
  if [ ! -f "$f" ] || [ "$(wc -l <"$f")" -le 40 ]; then
    FILES_OK=1
    echo "  missing or too short (<=40 lines): $f" >>"$TMP/files.out"
  fi
done
for s in spec-writing acceptance-criteria tdd-workflow run-and-verify code-review-rubric; do
  [ -f ".claude/skills/$s/SKILL.md" ] || FILES_OK=1
done
grep -q 'def test_skill_frontmatter' tests/test_skills.py 2>/dev/null &&
  "$PY" -m pytest -q tests/test_skills.py >"$TMP/skills.out" 2>&1 || FILES_OK=1
check "9. README/docs/labs/vps/prompts/hooks/AGENTS.md non-trivial; skills valid (tested)" "$FILES_OK"

# --- 10. guard hook blocks main pushes, allows agent branches ----------------
GUARD_OK=1
if [ -x .claude/hooks/guard.sh ]; then
  echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' |
    .claude/hooks/guard.sh >/dev/null 2>&1
  BLOCK_RC=$?
  echo '{"tool_name":"Bash","tool_input":{"command":"git push origin agent/1-x"}}' |
    .claude/hooks/guard.sh >/dev/null 2>&1
  ALLOW_RC=$?
  [ "$BLOCK_RC" -eq 2 ] && [ "$ALLOW_RC" -eq 0 ] && GUARD_OK=0
fi
check "10. guard.sh: exit 2 on push-to-main payload, exit 0 on agent branch" "$GUARD_OK"

# --- 11. quickstart works from a fresh copy ----------------------------------
FRESH="$TMP/fresh"
mkdir -p "$FRESH"
tar -cf - --exclude .venv --exclude .git --exclude runs --exclude .work \
  --exclude .agent-logs --exclude .pytest_cache --exclude .ruff_cache \
  --exclude __pycache__ . | (cd "$FRESH" && tar -xf -)
(cd "$FRESH" && PYTHON="$PY" ./scripts/demo.sh >"$TMP/fresh-demo.out" 2>&1)
check "11. make demo green from a fresh copy of the repo" $?

# --- 12. prompt files carry the required sections ----------------------------
PROMPTS_OK=0
for f in prompts/prd.md prompts/architect.md prompts/coder.md prompts/reviewer.md; do
  for marker in '## Role' '## Output contract' '## NEVER' '## Stop rule' '## Memory'; do
    grep -q "$marker" "$f" || {
      PROMPTS_OK=1
      echo "  $f missing '$marker'" >>"$TMP/prompts.out"
    }
  done
done
check "12. prompts have Role / Output contract / NEVER / Stop rule / Memory sections" "$PROMPTS_OK"

# --- 13. harness-owned completion (lying agent cannot finish the loop) -------
grep -q 'def test_lying_agent_does_not_complete' tests/test_loop.py 2>/dev/null &&
  "$PY" -m pytest -q tests/test_loop.py >"$TMP/loop.out" 2>&1
check "13. GoalLoop: lying agent (passes flipped + EXIT_SIGNAL, failing gate) never verifies" $?

# --- report -------------------------------------------------------------------
echo
echo "Agent Studio verification — spec.md §17"
echo "----------------------------------------"
for line in "${RESULTS[@]}"; do echo "$line"; done
echo "----------------------------------------"
echo "score: $PASS/13"
[ "$FAIL" -eq 0 ]
