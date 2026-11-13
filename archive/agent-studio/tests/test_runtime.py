"""Runtimes: argv construction, availability, fake scripting, factory."""

from pathlib import Path

from studio.config import RuntimeConfig
from studio.execution import FakeExecutor
from studio.runtime import ClaudeCodeRuntime, CodexRuntime, FakeRuntime, make_runtime

CLAUDE_CFG = RuntimeConfig(
    name="claude", cmd="claude", extra_flags=("--permission-mode", "acceptEdits"), kind="claude"
)
CODEX_CFG = RuntimeConfig(name="codex", cmd="codex", kind="codex")


def test_claude_argv_includes_headless_flags_and_agent():
    rt = ClaudeCodeRuntime(CLAUDE_CFG, FakeExecutor())
    argv = rt.build_argv("do the thing", agent="studio-coder")
    assert argv[:3] == ["claude", "-p", "do the thing"]
    assert ("--output-format", "text") == tuple(argv[3:5])
    assert ("--agent", "studio-coder") in tuple(zip(argv, argv[1:]))
    assert argv[-2:] == ["--permission-mode", "acceptEdits"]


def test_claude_run_goes_through_executor():
    executor = FakeExecutor()
    executor.queue(stdout="hello from claude")
    rt = ClaudeCodeRuntime(CLAUDE_CFG, executor)
    result = rt.run("hi", cwd=Path("/tmp"), timeout_s=5)
    assert result.ok and result.output == "hello from claude"
    assert executor.calls[0][0] == "claude"


def test_claude_failure_captures_stderr():
    executor = FakeExecutor()
    executor.queue(stderr="rate limited", returncode=1)
    rt = ClaudeCodeRuntime(CLAUDE_CFG, executor)
    result = rt.run("hi", cwd=Path("/tmp"))
    assert not result.ok and "rate limited" in result.output


def test_codex_argv_uses_exec_and_ignores_agent():
    rt = CodexRuntime(CODEX_CFG, FakeExecutor())
    assert rt.build_argv("fix it") == ["codex", "exec", "fix it"]
    executor = FakeExecutor()
    rt = CodexRuntime(CODEX_CFG, executor)
    rt.run("fix it", cwd=Path("/tmp"), agent="studio-coder")
    assert "--agent" not in executor.calls[0]


def test_availability_by_which(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda cmd: "/usr/bin/x" if cmd == "claude" else None)
    assert ClaudeCodeRuntime(CLAUDE_CFG, FakeExecutor()).available() is True
    assert CodexRuntime(CODEX_CFG, FakeExecutor()).available() is False


def test_fake_runtime_scripts_in_order_and_records():
    rt = FakeRuntime(["first", lambda prompt: f"echo: {prompt[:4]}"])
    a = rt.run("one", cwd=Path("/tmp"), agent="studio-prd")
    b = rt.run("twos", cwd=Path("/tmp"))
    c = rt.run("empty", cwd=Path("/tmp"))
    assert (a.output, b.output, c.output) == ("first", "echo: twos", "")
    assert rt.prompts == ["one", "twos", "empty"]
    assert rt.agents == ["studio-prd", None, None]
    assert rt.available() is True


def test_factory_maps_kind():
    assert isinstance(make_runtime(CLAUDE_CFG, FakeExecutor()), ClaudeCodeRuntime)
    assert isinstance(make_runtime(CODEX_CFG, FakeExecutor()), CodexRuntime)
    aliased = RuntimeConfig(name="reviewer-model", cmd="codex", kind="codex")
    assert isinstance(make_runtime(aliased, FakeExecutor()), CodexRuntime)
