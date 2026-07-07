PY := .venv/bin/python
RUFF := .venv/bin/ruff

.PHONY: test lint verify demo run

test:
	$(PY) -m pytest -q

lint:
	$(RUFF) check .

verify:
	./scripts/verify.sh

demo:
	PYTHON=$(abspath $(PY)) ./scripts/demo.sh

run:
	$(PY) -m studio run --watch
