---
name: run-and-verify
description: Verify behavior by actually running the app and probing it. Use before claiming any app-level task is done.
---

# Run the thing. Tests are necessary, not sufficient.

Unit tests pass while the app 500s on startup. Before claiming an app-level task done,
prove the running system behaves.

## Web app / API

```sh
# start clean, in the background, capture logs
python -m app & APP_PID=$!; sleep 1
# liveness first: does it even come up?
curl -sf localhost:8000/health || { kill $APP_PID; exit 1; }
# then behavior: probe the endpoints the task touched
curl -sf -X POST localhost:8000/todos -H 'Content-Type: application/json' -d '{"title":"x"}'
curl -sf localhost:8000/todos | jq -e 'length == 1'
kill $APP_PID
```

- Probe both the happy path and one failure path (bad payload → expected 4xx).
- Read the server log for tracebacks even when curl succeeded — a 200 with a stack
  trace in the log is a bug you just shipped.
- Kill what you start; a leaked server makes the next iteration's probe lie.

## CLI

Run the actual command a user would type, on a fresh temp dir. Check exit code AND
output. Then run the error case (`missing-arg`, nonexistent file) and check it fails
loudly, not silently.

## Evidence discipline

- Paste the verbatim command + output into your progress entry / PR body. "It works"
  is not evidence; a transcript is.
- If you cannot run it (missing credential, port in use you can't free), say exactly
  that — a skipped verification stated plainly beats a fabricated one. The harness
  re-runs the gates regardless; lying only wastes an iteration.
