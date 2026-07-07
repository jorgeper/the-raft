"""Streaming: executor.stream, stream-json parsing against a recorded real
sample, the OutputCoalescer, and the generic codex/fake streaming paths."""

import json
from pathlib import Path

from studio.config import RuntimeConfig
from studio.events import EventLog, OutputCoalescer
from studio.execution import CommandExecutor, FakeExecutor
from studio.runtime.claude_code import ClaudeCodeRuntime
from studio.runtime.codex import CodexRuntime
from studio.runtime.fake import FakeRuntime

SAMPLE = Path(__file__).resolve().parent / "data" / "claude-stream-sample.jsonl"
CLAUDE_CFG = RuntimeConfig(name="claude", cmd="claude", kind="claude")
CODEX_CFG = RuntimeConfig(name="codex", cmd="codex", kind="codex")


# ------------------------------------------------------------ executor.stream


def test_real_executor_streams_lines_in_order(tmp_path):
    lines: list[str] = []
    result = CommandExecutor().stream(
        ["sh", "-c", "printf 'one\\ntwo\\n'; printf 'three\\n'"],
        on_line=lines.append, cwd=tmp_path,
    )
    assert result.ok
    assert lines == ["one", "two", "three"]
    assert result.stdout == "one\ntwo\nthree\n"


def test_real_executor_stream_timeout_kills(tmp_path):
    lines: list[str] = []
    result = CommandExecutor().stream(
        ["sh", "-c", "echo started; sleep 30; echo never"],
        on_line=lines.append, cwd=tmp_path, timeout_s=1,
    )
    assert lines == ["started"]
    assert result.returncode != 0


def test_real_executor_stream_missing_binary():
    result = CommandExecutor().stream(["definitely-not-a-command-xyz"], on_line=lambda _: None)
    assert result.returncode == 127


def test_consumer_exception_does_not_kill_the_stream(tmp_path):
    seen: list[str] = []

    def flaky(line: str) -> None:
        seen.append(line)
        raise RuntimeError("consumer bug")

    result = CommandExecutor().stream(
        ["sh", "-c", "printf 'a\\nb\\n'"], on_line=flaky, cwd=tmp_path
    )
    assert result.ok and seen == ["a", "b"]


# --------------------------------------------------- claude stream-json parse


def test_claude_streaming_parses_recorded_sample(tmp_path):
    executor = FakeExecutor()
    executor.queue(stdout=SAMPLE.read_text())
    rt = ClaudeCodeRuntime(CLAUDE_CFG, executor)
    chunks: list[tuple[str, str]] = []
    result = rt.run("do it", cwd=tmp_path, agent="studio-coder",
                    on_output=lambda c, ch: chunks.append((c, ch)))
    # argv switched to streaming form, --verbose included (CLI requires it with -p)
    argv = executor.calls[0]
    assert ("--output-format", "stream-json") in tuple(zip(argv, argv[1:]))
    assert "--verbose" in argv and ("--agent", "studio-coder") in tuple(zip(argv, argv[1:]))
    # text blocks streamed as text; tool_use as a tool notice
    texts = [c for c, ch in chunks if ch == "text"]
    tools = [c for c, ch in chunks if ch == "tool"]
    assert "hello studio" in "".join(texts)
    assert "Working on it. " in texts and "Tests are green." in texts
    assert any(t.startswith("tool: Bash") and "pytest -q" in t for t in tools)
    # the result line supplies the final output; unknown line types were skipped
    assert result.output == "hello studio"
    assert result.ok


def test_claude_streaming_tolerates_garbage_and_missing_result(tmp_path):
    executor = FakeExecutor()
    lines = [
        "not json at all",
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "partial"}]}}),
        json.dumps({"type": "mystery_event"}),
    ]
    executor.queue(stdout="\n".join(lines))
    rt = ClaudeCodeRuntime(CLAUDE_CFG, executor)
    chunks = []
    result = rt.run("go", cwd=tmp_path, on_output=lambda c, ch: chunks.append(c))
    assert result.output == "partial"  # falls back to concatenated text pieces
    assert chunks == ["partial"]


def test_claude_without_on_output_is_unchanged(tmp_path):
    executor = FakeExecutor()
    executor.queue(stdout="plain text result")
    rt = ClaudeCodeRuntime(CLAUDE_CFG, executor)
    result = rt.run("go", cwd=tmp_path)
    argv = executor.calls[0]
    assert ("--output-format", "text") in tuple(zip(argv, argv[1:]))
    assert "--verbose" not in argv
    assert result.output == "plain text result"


# ----------------------------------------------------- codex + fake streaming


def test_codex_streams_raw_lines(tmp_path):
    executor = FakeExecutor()
    executor.queue(stdout="thinking...\ndone.\n")
    rt = CodexRuntime(CODEX_CFG, executor)
    chunks = []
    result = rt.run("go", cwd=tmp_path, on_output=lambda c, ch: chunks.append((c, ch)))
    assert chunks == [("thinking...\n", "text"), ("done.\n", "text")]
    assert result.ok


def test_fake_runtime_streams_scripted_chunks(tmp_path):
    rt = FakeRuntime([("final answer", ["chunk one ", "chunk two"])])
    chunks = []
    result = rt.run("go", cwd=tmp_path, on_output=lambda c, ch: chunks.append(c))
    assert chunks == ["chunk one ", "chunk two"]
    assert result.output == "final answer"
    # and without on_output the tuple still returns its final text
    rt = FakeRuntime([("final answer", ["ignored"])])
    assert rt.run("go", cwd=tmp_path).output == "final answer"


# ------------------------------------------------------------- the coalescer


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def events_from(log_path):
    return [json.loads(line) for line in log_path.read_text().splitlines()]


def test_coalescer_flushes_by_size(tmp_path):
    log = EventLog(tmp_path / "e.jsonl")
    coalescer = OutputCoalescer(log, max_chars=10, clock=Clock())
    coalescer.feed("aaaa")
    assert not (tmp_path / "e.jsonl").exists()  # under threshold: buffered
    coalescer.feed("bbbbbbbb")  # crosses 10
    events = events_from(tmp_path / "e.jsonl")
    assert len(events) == 1
    assert events[0]["data"] == {"chunk": "aaaabbbbbbbb", "channel": "text", "done": False}


def test_coalescer_flushes_by_time(tmp_path):
    clock = Clock()
    log = EventLog(tmp_path / "e.jsonl")
    coalescer = OutputCoalescer(log, max_chars=10_000, max_interval_s=1.0, clock=clock)
    coalescer.feed("early")
    clock.now = 1.5
    coalescer.feed("late")  # interval elapsed -> flush
    events = events_from(tmp_path / "e.jsonl")
    assert len(events) == 1 and events[0]["data"]["chunk"] == "earlylate"


def test_coalescer_flushes_on_channel_change_and_close(tmp_path):
    log = EventLog(tmp_path / "e.jsonl")
    coalescer = OutputCoalescer(log, max_chars=10_000, clock=Clock())
    coalescer.feed("some prose ")
    coalescer.feed("tool: Bash `pytest`", channel="tool")  # channel change flushes prose
    coalescer.close()
    coalescer.close()  # idempotent
    events = events_from(tmp_path / "e.jsonl")
    assert [e["data"]["channel"] for e in events] == ["text", "tool"]
    assert events[-1]["data"]["done"] is True
    assert events[0]["data"]["done"] is False


def test_coalescer_close_with_empty_buffer_still_marks_done(tmp_path):
    log = EventLog(tmp_path / "e.jsonl")
    coalescer = OutputCoalescer(log, max_chars=5, clock=Clock())
    coalescer.feed("123456")  # flushed by size
    coalescer.close()  # nothing buffered: emits an empty done marker
    events = events_from(tmp_path / "e.jsonl")
    assert events[-1]["data"]["done"] is True
    assert [e["data"]["chunk"] for e in events][0] == "123456"


def test_coalescer_caps_chunk_size(tmp_path):
    log = EventLog(tmp_path / "e.jsonl")
    coalescer = OutputCoalescer(log, max_chars=5000, clock=Clock())
    coalescer.feed("x" * 4000)
    coalescer.close()
    events = events_from(tmp_path / "e.jsonl")
    assert all(len(e["data"]["chunk"]) <= 2000 for e in events)  # TAIL_CAPS["chunk"]
