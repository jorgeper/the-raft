# Decisions — observability + console build

- Console package named `studio_console`; verify.sh's decoupling grep is written so
  `studio_console` imports don't false-positive on the forbidden `studio.` pattern.
- Textual 8.x + rich 15.x pinned by `>=` floors only; APIs verified against live
  docs (context7) rather than training data.
- pytest asyncio_mode=auto so textual pilot tests need no per-test decorators.
- Screens C2–C4 landed as one commit (the app is one coherent module); C1 and C5 stayed separate.
- Feed renders newest-at-bottom with auto-scroll (tail -f intuition) rather than the
  spec mockup's newest-on-top — incremental DataTable rows keep the cursor stable.
- Textual 8: Static.renderable is gone; render() returns Content — tests use str(render()).
- Tailer detects same-size in-place rewrites via a fixed 64-byte prefix signature
  (startswith comparison so normal growth never looks like rotation).
- Demo's coder loop runs twice (initial + review-feedback) so live checks grep
  verified=[1-9], not verified=1.
- agent-studio is now pip-installable (hatchling) and installed -e into its venv so
  `python -m studio` works from any cwd — required by the snapshot contract.
- Loop runtime_start events carry run_dir=null (the loop doesn't own a RunStore);
  the orchestrator-level runtime events carry the real run_dir.
- stream-json format VERIFIED against a real `claude -p --output-format stream-json`
  run (v2.x): --verbose is REQUIRED with -p; line types seen: system(init/hook_*),
  assistant{message.content[text|thinking|tool_use]}, rate_limit_event, result
  {subtype, result}. Sanitized capture: agent-studio/tests/data/claude-stream-sample.jsonl.
- Parser skips thinking blocks (out of scope) and all unknown line types.
- executor.stream kills the whole process GROUP on deadline (start_new_session +
  killpg) — killing just `sh` left grandchildren holding the pipe open.
- The live pane keeps the last stream after dispatch_end, marked "(finished)" —
  a blank pane between dispatches read as broken.
- Coalescer's final done-flush may carry an empty chunk; verify check 11 counts
  non-empty chunks separately (matches spec-streaming §6 wording exactly).
