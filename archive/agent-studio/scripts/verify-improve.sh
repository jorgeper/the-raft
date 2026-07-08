#!/usr/bin/env bash
# THE FINISH LINE for the self-improving agent set — self-improve-spec.md §11.
# Exits 0 only when all 12 pass. Strengthening checks is allowed; weakening is not.
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

todo() { # placeholder for a milestone not built yet — always fails
  RESULTS+=("⬜ $1 (not built yet)")
  FAIL=$((FAIL + 1))
}

# --- 1. full suite green, pre-existing tests unmodified ------------------------
"$PY" -m pytest --cov=studio --cov-report=term --cov-fail-under=80 >"$TMP/pytest.out" 2>&1
check "1. pytest green (coverage >= 80%)" $?

# --- 2. lint clean --------------------------------------------------------------
"$RUFF" check . >"$TMP/ruff.out" 2>&1
check "2. ruff check . clean" $?

# --- 3. agent sets: selection, errors, backward compat (R1/R3/R4) ---------------
"$PY" -m pytest tests/test_agent_sets.py -q >"$TMP/sets.out" 2>&1
check "3. agent sets: active-set selection, error cases, backward compat" $?

# --- 4. scorecard --json parseable (R10), against the checked-in fixture ---------
"$PY" -m studio scorecard --json --events tests/fixtures/scorecard-events.jsonl \
  >"$TMP/scorecard.json" 2>&1 &&
  if command -v jq >/dev/null 2>&1; then
    jq -e '.agents' "$TMP/scorecard.json" >/dev/null
  else
    "$PY" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["agents"]' "$TMP/scorecard.json"
  fi &&
  "$PY" -m pytest tests/test_metrics.py -q >"$TMP/metrics.out" 2>&1
check "4. studio scorecard --json parseable (.agents); metrics unit-tested" $?

# --- 5. reflection: LESSON parsing (R13-R15) ------------------------------------
grep -q 'def test_harvest_caps_at_three_and_truncates' tests/test_reflection.py &&
  grep -q 'def test_goal_loop_calls_output_hook_each_iteration' tests/test_reflection.py &&
  "$PY" -m pytest tests/test_reflection.py -q >"$TMP/reflection.out" 2>&1
check "5. LESSON parsing: journal append, 3-line cap, lesson events (tested)" $?

# --- 6. improver: trigger, contract, single-flight (R8/R17/R18/R20) --------------
grep -q 'def test_single_flight_r8' tests/test_improver.py &&
  grep -q 'def test_improver_malformed_output_goes_needs_human' tests/test_improver.py &&
  "$PY" -m pytest tests/test_improver.py -q >"$TMP/improver.out" 2>&1
check "6. improver: trigger cadence, output contract, malformed -> needs-human, single-flight" $?

# --- 7. allowlist enforced at validation and apply (R19/R21) ---------------------
grep -q 'def test_dispatch_stage_rejects' tests/test_improve_allowlist.py &&
  grep -q 'def test_apply_stage_rejects' tests/test_improve_allowlist.py &&
  "$PY" -m pytest tests/test_improve_allowlist.py -q >"$TMP/allowlist.out" 2>&1
check "7. allowlist rejects studio/ + classic prompts/ at validation AND apply" $?

# --- 8. human gate + kind guard (R6/R7) ------------------------------------------
grep -q 'def test_improve_approval_is_human_only' tests/test_improve_gate.py &&
  grep -q 'def test_non_improvement_kind_cannot_enter_improve_states' tests/test_improve_gate.py &&
  "$PY" -m pytest tests/test_improve_gate.py -q >"$TMP/gate.out" 2>&1
check "8. human gate rejects agent actors; kind guard both directions (tested)" $?

# --- 9. apply/reject/revert-diff (R21/R22/R25) -----------------------------------
grep -q 'def test_approve_applies_commits_and_records' tests/test_improve_apply.py &&
  grep -q 'def test_reject_applies_nothing_and_records' tests/test_improve_apply.py &&
  grep -q 'def test_revert_diff_matches_git_revert' tests/test_improve_apply.py &&
  "$PY" -m pytest tests/test_improve_apply.py -q >"$TMP/apply.out" 2>&1
check "9. apply commits only allowlisted paths; reject applies nothing; revert diff = git revert" $?

# --- 10. regression guard (R23) ---------------------------------------------------
todo "10. tests/test_regression_guard.py"

# --- 11. demo --improve end-to-end -------------------------------------------------
todo "11. python -m studio.demo --improve reaches improve:review"

# --- 12. the original v1 finish line still passes ---------------------------------
./scripts/verify.sh >"$TMP/verify-v1.out" 2>&1
check "12. scripts/verify.sh still 13/13 (classic set untouched)" $?

# --- report -------------------------------------------------------------------
echo
echo "Self-improving agents verification — self-improve-spec.md §11"
echo "--------------------------------------------------------------"
for line in "${RESULTS[@]}"; do echo "$line"; done
echo "--------------------------------------------------------------"
echo "score: $PASS/12"
[ "$FAIL" -eq 0 ]
