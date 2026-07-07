#!/usr/bin/env bash
# Offline end-to-end demo: full lifecycle on a throwaway repo, no API keys needed.
set -u
cd "$(dirname "$0")/.."
PY="${PYTHON:-$(pwd)/.venv/bin/python}"
if [ ! -x "$PY" ]; then
  PY="$(command -v python3)"
fi
exec "$PY" -m studio.demo
