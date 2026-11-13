"""Change 5: the retry-context extraction fed to the next coder pass."""
from loop import last_failure

FAILED = """# Issue 4 scratchpad

## Coder session

ok=True cost=$0.10

## Independent inner loop

passed=False

```
FAILED tests/test_auth.py::test_login - assert 500 == 200
```
"""


def test_last_failed_inner_loop_is_returned():
    out = last_failure(FAILED)
    assert out is not None
    assert "test_auth" in out


def test_green_last_attempt_returns_none():
    memo = FAILED + "\n## Independent inner loop\n\npassed=True\n\nall green\n"
    assert last_failure(memo) is None


def test_memo_without_inner_loop_returns_none():
    assert last_failure("# Issue 5 scratchpad\n\n## Design draft\n\nstuff\n") is None
