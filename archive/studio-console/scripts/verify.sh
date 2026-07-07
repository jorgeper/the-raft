#!/usr/bin/env bash
# Finish line for the observability + console build — spec.md §8 exactly.
# Exits 0 only when all 9 checks pass. Strengthening allowed; weakening is not.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STUDIO="$ROOT/../agent-studio"
PY="${PYTHON:-$ROOT/.venv/bin/python}"
RUFF="${RUFF:-$ROOT/.venv/bin/ruff}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
RESULTS=()
check() {
  if [ "$2" -eq 0 ]; then RESULTS+=("✅ $1"); PASS=$((PASS + 1)); else RESULTS+=("❌ $1"); FAIL=$((FAIL + 1)); fi
}

# --- 1. console lint + tests + coverage --------------------------------------
"$RUFF" check . >"$TMP/ruff.out" 2>&1
RUFF_RC=$?
"$PY" -m pytest --cov=studio_console --cov-report=term --cov-fail-under=75 >"$TMP/pytest.out" 2>&1
PYTEST_RC=$?
NTESTS=$(grep -Eo '[0-9]+ passed' "$TMP/pytest.out" | grep -Eo '[0-9]+' | head -1 || echo 0)
check "1. console: ruff clean, pytest green >=20 tests (got $NTESTS), coverage >=75%" \
  "$([ "$RUFF_RC" -eq 0 ] && [ "$PYTEST_RC" -eq 0 ] && [ "${NTESTS:-0}" -ge 20 ]; echo $?)"

# --- 2. fixture check: >=3 agents, a done lifecycle ---------------------------
"$PY" -m studio_console --check --events fixtures/demo-events.jsonl >"$TMP/check.out" 2>&1
C2=$?
grep -Eq '^agents: [^,]+,[^,]+,' "$TMP/check.out" || C2=1
grep -Eq 'done=[1-9]' "$TMP/check.out" || C2=1
check "2. --check on fixture: exit 0, >=3 agents, an item reaching done" "$C2"

# --- 3. pilot smoke test exists and passes ------------------------------------
grep -rq 'def test_app_boots_on_fixture' tests/ &&
  "$PY" -m pytest tests/test_app.py >"$TMP/app.out" 2>&1
check "3. textual pilot smoke test (app boots on fixture, dashboard renders)" $?

# --- 4. LIVE integration: fresh demo stream -> --check -------------------------
C4=1
DEMO_OUT=$("$STUDIO/.venv/bin/python" -m studio.demo --keep 2>/dev/null | tail -40)
SANDBOX=$(printf '%s' "$DEMO_OUT" | grep -Eo 'sandbox: [^ ]+' | head -1 | cut -d' ' -f2)
EVENTS="$SANDBOX/studio/.agent-logs/events.jsonl"
if [ -n "$SANDBOX" ] && [ -f "$EVENTS" ]; then
  "$PY" -m studio_console --check --events "$EVENTS" >"$TMP/live.out" 2>&1 &&
    grep -Eq 'verified=[1-9]' "$TMP/live.out" &&
    grep -Eq 'done=[1-9]' "$TMP/live.out" && C4=0
fi
check "4. live integration: fresh demo events -> check sees verified loop + done" "$C4"

# --- 5. snapshot contract in the kept sandbox ----------------------------------
C5=1
if [ -n "${SANDBOX:-}" ] && [ -f "$SANDBOX/studio/config/studio.yaml" ]; then
  (cd "$SANDBOX/studio" &&
    "$STUDIO/.venv/bin/python" -m studio --config config/studio.yaml status --json >"$TMP/status.json" 2>&1 &&
    "$STUDIO/.venv/bin/python" -m studio --config config/studio.yaml show 1 --json >"$TMP/show.json" 2>&1)
  "$PY" - "$TMP/status.json" "$TMP/show.json" <<'EOF' && C5=0
import json, sys
status = json.load(open(sys.argv[1]))
assert "generated" in status and isinstance(status["items"], list) and status["items"]
item = status["items"][0]
assert all(k in item for k in ("id", "title", "state", "kind", "claimed_by", "updated", "url"))
show = json.load(open(sys.argv[2]))
assert show["id"] == "1" and isinstance(show["comments"], list) and show["comments"]
assert all("author" in c and "body" in c for c in show["comments"])
EOF
fi
check "5. snapshot contract: status --json and show --json parse with §2 fields" "$C5"
rm -rf "${SANDBOX:-/nonexistent}" 2>/dev/null

# --- 6. agent-studio: no regressions -------------------------------------------
(cd "$STUDIO" && ./scripts/verify.sh >"$TMP/sv.out" 2>&1)
SV=$?
(cd "$STUDIO" && ./scripts/verify-docs.sh >"$TMP/svd.out" 2>&1)
SVD=$?
grep -q '07-observability' "$STUDIO/scripts/verify-docs.sh" || SVD=1
check "6. agent-studio verify.sh 13/13 AND verify-docs.sh green (07 in manifest)" \
  "$([ "$SV" -eq 0 ] && [ "$SVD" -eq 0 ]; echo $?)"

# --- 7. Part A emission tests exist and pass ------------------------------------
grep -q 'def test_' "$STUDIO/tests/test_events.py" 2>/dev/null &&
  (cd "$STUDIO" && ./.venv/bin/python -m pytest -q tests/test_events.py >"$TMP/ev.out" 2>&1)
check "7. agent-studio emission tests (tests/test_events.py) exist and pass" $?

# --- 8. docs + fixture substance -------------------------------------------------
C8=0
[ -f README.md ] && [ "$(wc -l <README.md)" -gt 60 ] && grep -qi 'keybinding' README.md || C8=1
OBS="$STUDIO/docs/architecture/07-observability.md"
[ -f "$OBS" ] && [ "$(wc -l <"$OBS")" -gt 80 ] && grep -q '07-observability' "$STUDIO/docs/README.md" || C8=1
NEV=$(wc -l <fixtures/demo-events.jsonl 2>/dev/null || echo 0)
NKINDS=$("$PY" -c "
import json
kinds=set()
for line in open('fixtures/demo-events.jsonl'):
    kinds.add(json.loads(line)['kind'])
print(len(kinds))" 2>/dev/null || echo 0)
[ "${NEV:-0}" -ge 40 ] && [ "${NKINDS:-0}" -ge 8 ] || C8=1
check "8. README (>60l, keybindings), contract doc (>80l, indexed), fixture (>=40 ev, >=8 kinds: got $NEV/$NKINDS)" "$C8"

# --- 9. hygiene + enforced decoupling ---------------------------------------------
C9=0
grep -rEn 'TODO|TBD|FIXME' studio_console/ >"$TMP/c9" 2>/dev/null && C9=1
grep -rEn 'TODO|TBD|FIXME' "$OBS" >>"$TMP/c9" 2>/dev/null && C9=1
grep -rEn '(^|[^_[:alnum:]])(from|import) studio(\.|$| )' studio_console/ tests/ >>"$TMP/c9" 2>/dev/null && C9=1
check "9. no TODOs; console never imports studio.* (decoupling enforced)" "$C9"

# --- 10. streaming unit proof (spec-streaming §6.10) ---------------------------------
C10=1
if grep -q 'def test_' "$STUDIO/tests/test_streaming.py" 2>/dev/null &&
  ls "$STUDIO"/tests/data/*stream* >/dev/null 2>&1; then
  grep -q 'coalescer' "$STUDIO/tests/test_streaming.py" &&
    (cd "$STUDIO" && ./.venv/bin/python -m pytest -q tests/test_streaming.py >"$TMP/stream.out" 2>&1) &&
    (cd "$STUDIO" && ./.venv/bin/python -m pytest -q >"$TMP/allstudio.out" 2>&1) && C10=0
fi
check "10. streaming units: executor.stream, stream-json parse (recorded sample), coalescer" "$C10"

# --- 11. contract proof, live: agent_output in a fresh demo stream -------------------
C11=1
SANDBOX2=$("$STUDIO/.venv/bin/python" -m studio.demo --keep 2>/dev/null | grep -Eo 'sandbox: [^ ]+' | head -1 | cut -d' ' -f2)
EV2="$SANDBOX2/studio/.agent-logs/events.jsonl"
if [ -f "$EV2" ]; then
  "$PY" - "$EV2" fixtures/demo-events.jsonl <<'EOF' && grep -q 'agent_output' "$OBS" && C11=0
import json, sys
for path in sys.argv[1:3]:
    events = [json.loads(line) for line in open(path) if '"agent_output"' in line]
    events = [e for e in events if e["kind"] == "agent_output"]
    non_empty = [e for e in events if e["data"].get("chunk")]
    assert len(non_empty) >= 3, f"{path}: only {len(non_empty)} non-empty agent_output chunks"
    assert any(e["data"].get("done") for e in events), f"{path}: no done flush"
EOF
fi
check "11. live + fixture streams carry agent_output (>=3, non-empty, done-flush); doc 07 updated" "$C11"

# --- 12. console proof: buffer folding, feed filter, live pane in pilot --------------
grep -q 'def test_live_pane_shows_streamed_text' tests/test_app.py 2>/dev/null &&
  grep -rq 'agent_output' tests/test_state.py &&
  "$PY" -m pytest -q tests/test_app.py tests/test_state.py >"$TMP/c12.out" 2>&1
check "12. console: agent_output folding + feed filter tested; live pane proven in pilot" $?

echo
echo "Studio Console verification — spec.md §8 + spec-streaming.md §6"
echo "------------------------------------------"
for line in "${RESULTS[@]}"; do echo "$line"; done
echo "------------------------------------------"
echo "score: $PASS/12"
[ "$FAIL" -gt 0 ] && { echo "details:"; cat "$TMP"/c9 "$TMP/check.out" 2>/dev/null | head -20; }
[ "$FAIL" -eq 0 ]
