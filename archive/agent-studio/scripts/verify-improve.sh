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

# --- 4. scorecard --json parseable (R10) ----------------------------------------
todo "4. studio scorecard --json | jq -e .agents"

# --- 5. reflection: LESSON parsing (R13-R15) ------------------------------------
todo "5. tests/test_reflection.py"

# --- 6. improver: trigger, contract, single-flight (R8/R17/R18/R20) --------------
todo "6. tests/test_improver.py"

# --- 7. allowlist enforced at validation and apply (R19/R21) ---------------------
todo "7. tests/test_improve_allowlist.py"

# --- 8. human gate + kind guard (R6/R7) ------------------------------------------
todo "8. tests/test_improve_gate.py"

# --- 9. apply/reject/revert-diff (R21/R22/R25) -----------------------------------
todo "9. tests/test_improve_apply.py"

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
