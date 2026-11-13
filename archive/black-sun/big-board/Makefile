PY := .venv/bin/python
RUFF := .venv/bin/ruff

.PHONY: run demo test lint verify

run:
	$(PY) -m bigboard

demo:
	$(PY) -m bigboard --replay fixtures/demo-events.jsonl --speed 20

test:
	$(PY) -m pytest -q

lint:
	$(RUFF) check .

verify:
	./scripts/verify.sh
