# Decisions — observability + console build

- Console package named `studio_console`; verify.sh's decoupling grep is written so
  `studio_console` imports don't false-positive on the forbidden `studio.` pattern.
- Textual 8.x + rich 15.x pinned by `>=` floors only; APIs verified against live
  docs (context7) rather than training data.
- pytest asyncio_mode=auto so textual pilot tests need no per-test decorators.
