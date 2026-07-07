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
