# Deliverator improvements: parallelism, live tmux visibility, and bug fixes

This document specifies changes to the orchestrator in `deliverator/orchestrator/`.
Read `OVERVIEW.md`, `AGENTS.md`, and all files in `orchestrator/` before starting.
Preserve the project's core invariants throughout:

1. **GitHub labels are the only workflow state.** The loop must remain killable at
   any moment and restartable with no lost state beyond the in-flight step.
2. **Agents stay stateless.** All memory lives in the per-issue memo files and in
   GitHub comments/PRs. Do not introduce long-lived agent sessions with
   accumulated context.
3. **Nothing certifies its own work.** The independent Docker re-check
   (`_inner_loop_in_docker`) must still gate every implementation PR.
4. **Human gates are unchanged.** Every `agent:needs-human` touch point stays.

Implement the changes in the order below (each builds on the previous). Keep the
codebase small and readable — it is currently ~900 lines and deliberately so.

---

## Change 1 (BUG FIX, highest priority): code reviewers never see the code

**Where:** `loop.py`, `run_code_review()`.

**Problem:** Both reviewer calls receive `memo.read_text()` — the scratchpad of
design notes and session summaries. The coder's summary is truncated to 2000
characters and usually contains no code. The "correctness" and "security"
reviewers are therefore reviewing prose about the code, not the diff.

**Fix:** Before calling the reviewers, produce the actual diff from the issue's
worktree:

```python
wt = worktree.create(issue.number)
diff = subprocess.run(
    ["git", "diff", "main...HEAD"],
    cwd=wt, capture_output=True, text=True).stdout
```

Pass the reviewers a combined document: the DESIGN.md content (acceptance
criteria live there), then the full diff, then the memo as supporting context.
If the diff exceeds a size guard (say 60k characters), truncate the memo first,
then the diff tail, and say so explicitly in the prompt so the reviewer knows it
saw a partial diff. Also raise `max_tokens` for these two calls if needed.

**Acceptance:** a code-review comment on a test issue quotes or references
specific lines/files from the diff, which is only possible if the diff was in
context.

---

## Change 2: parallelize the reviewer pairs

**Where:** `loop.py`, `run_design_reviewers()` and `run_code_review()`.

The two reviewer calls in each function are independent. Run them concurrently
with `concurrent.futures.ThreadPoolExecutor(max_workers=2)` (the calls are pure
I/O). Preserve the existing output order in the memo and the GitHub comment
(feasibility/correctness first, security second).

---

## Change 3: parallelize across issues

**Where:** `loop.py`, `one_pass()` and supporting modules.

**Goal:** advance multiple issues concurrently instead of strictly one at a time.
Concurrency is safe because worktrees isolate the filesystem and labels isolate
workflow state — but three pieces of shared state must be made thread-safe
first (3a–3c), then the pool itself (3d).

### 3a. Thread-safe cost ledger

**Where:** `llm.py`. `_usd_spent`, `_by_role`, and the CSV append in
`_log_cost()` are mutated without synchronization. Add a single
`threading.Lock` guarding all reads/writes of these (including `spent()` and
`add_cost()`). Keep the CSV append inside the lock so rows never interleave.

### 3b. Thread-safe worktree creation

**Where:** `worktree.py`. `git worktree add` mutates the shared `.git`
directory, and `create()` has a check-then-act race on `path.exists()`. Add a
module-level `threading.Lock` around the body of `create()` (and `cleanup()`).
Work *inside* worktrees needs no locking.

### 3c. Budget cap under concurrency

**Where:** `loop.py`. The `spent() >= MAX_USD` check becomes racy. Perform the
check immediately before dispatching each task (under the ledger lock is fine)
and stop submitting new tasks once the cap is reached. Document in a comment
that the cap is now soft by up to the cost of in-flight tasks — do not try to
kill in-flight coder runs.

### 3d. The pool

Rewrite `one_pass()` to collect `(label, handler, issue)` tuples across all
stages, then dispatch through a `ThreadPoolExecutor`. Requirements:

- Pool size from env var `MAX_PARALLEL` (default 3).
- **At most one in-flight task per issue number.** An issue must never be
  handled by two workers in the same pass (dedupe by issue number when
  collecting; first matching stage wins, preserving current STAGES precedence).
- Wrap each handler in the existing try/except so one failure doesn't kill the
  pass; keep posting the `⚠️ Agent error` comment.
- Rich console output should prefix lines with the issue number so interleaved
  logs stay readable.
- GitHub API calls: add a small retry with exponential backoff (3 attempts) on
  rate-limit/5xx errors in `gh.py`, since concurrency raises the odds of
  secondary rate limits.

**Acceptance:** with three issues labeled `agent:trivial`, three coder runs
proceed concurrently in three worktrees; `costs.csv` stays well-formed; a
`Ctrl-C` mid-pass followed by restart resumes correctly from labels.

---

## Change 4: live visibility — coder runs in a tmux window per issue

**Where:** `loop.py` (`_coder_headless`) plus a new small module
`tmuxview.py`.

**Goal:** each coder run is watchable live. tmux is the *viewport only* —
GitHub labels remain the sole scheduler and source of truth. If tmux is not
available or `TMUX_VIEW=0`, fall back to exactly the current captured-subprocess
behavior.

### Design

1. Always switch the coder to streaming output and persist it:
   `--output-format stream-json --verbose`, written to
   `orchestrator/logs/coder-issue-<N>.jsonl` (append per pass, with a
   `=== pass <timestamp> ===` separator line). This happens in both tmux and
   fallback modes, so there is always a reviewable transcript.
2. When tmux mode is on:
   - Ensure a tmux session named `deliverator` exists
     (`tmux has-session -t deliverator || tmux new-session -d -s deliverator`).
   - For each coder run, create/replace a window named `issue-<N>` that runs the
     coder command inside the worktree, piping through `tee` into the jsonl log,
     and additionally rendering a human-readable stream (pipe through a tiny
     `python -m` formatter or `jq` if available; plain tee is an acceptable
     first version).
   - **Completion detection:** the window's shell command must, after the coder
     exits, write the coder's final JSON result to a sentinel file
     `logs/coder-issue-<N>.done` (the last JSON object of the stream, or an
     error marker plus exit code). The orchestrator polls for this file
     (every ~5s, honoring the existing 3600s timeout), reads it, deletes it,
     and proceeds exactly as it does today with the parsed result:
     `(ok, summary, cost_usd)`.
   - The window should stay open showing the tail after completion (end the
     shell command with something like `; echo DONE; sleep 86400` or use tmux
     `remain-on-exit`) so a human can scroll back. Windows for merged/closed
     issues can be cleaned up opportunistically at the start of each pass.
3. Extract cost from the stream's final result object
   (`total_cost_usd`) the same way the current JSON parse does; on parse
   failure return `ok=False` with the log tail as summary (mirror current
   fallback behavior).
4. README: add a short "Watching agents live" section —
   `tmux attach -t deliverator`, one window per active issue, plus the
   `tail -f logs/coder-issue-N.jsonl` alternative for non-tmux users.

**Acceptance:** with `TMUX_VIEW=1` and two issues coding in parallel,
`tmux attach -t deliverator` shows two windows with live coder output; the loop
still opens PRs and flips labels correctly; with tmux absent, everything works
as before.

---

## Change 5 (smaller fixes, do last)

1. **Coder summary truncation:** the 2000-char cap on the coder summary feeds
   the memo that later stages read. Now that Change 1 gives reviewers the real
   diff, keep the cap but note in the memo that the full transcript is in
   `logs/coder-issue-<N>.jsonl`.
2. **Retry context:** when a coder pass fails and the issue stays in
   `agent:coding`, append the Docker failure log to the memo under a clearly
   named section (already done) AND include the last failure section explicitly
   at the top of the next coder prompt ("Previous attempt failed with: ...") so
   the retry doesn't depend on the model noticing it mid-memo.
3. **`datetime.utcnow()` deprecation** in `dashboard.py`: switch to
   `datetime.datetime.now(datetime.UTC)` (llm.py already does this).
4. **Docker timeout:** `_inner_loop_in_docker` has `timeout=300`; make it
   configurable via `SANDBOX_TIMEOUT` env var (default 300) since parallel runs
   on one machine will slow each container down.

---

## Testing expectations

Add lightweight tests where feasible without heavy mocking:

- Unit-test the diff-assembly + truncation logic of Change 1 (pure function —
  factor it out as one).
- Unit-test issue dedup and stage precedence in the new `one_pass()` task
  collection (factor collection into a pure function taking
  `{label: [issues]}`).
- Unit-test the sentinel-file parse of Change 4 (valid result, malformed JSON,
  error marker).
- Concurrency smoke test for the cost ledger: N threads calling `add_cost`,
  assert total and CSV row count.

Run the repo's lint and tests until green. Do not push; commit with clear
messages, one commit per numbered change.
