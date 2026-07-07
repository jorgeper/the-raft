"""Tailer: appends, partial lines, truncation, rotation, missing files."""

from studio_console.tailer import EventTailer


def test_missing_file_is_quiet(tmp_path):
    tailer = EventTailer(tmp_path / "nope.jsonl")
    assert tailer.poll() == []


def test_appends_arrive_incrementally(tmp_path):
    path = tmp_path / "e.jsonl"
    tailer = EventTailer(path)
    path.write_text("one\n")
    assert tailer.poll() == ["one"]
    assert tailer.poll() == []
    with path.open("a") as fh:
        fh.write("two\nthree\n")
    assert tailer.poll() == ["two", "three"]


def test_partial_line_buffers_until_newline(tmp_path):
    path = tmp_path / "e.jsonl"
    tailer = EventTailer(path)
    path.write_text("start")
    assert tailer.poll() == []  # incomplete — held back
    with path.open("a") as fh:
        fh.write("-end\nnext\n")
    assert tailer.poll() == ["start-end", "next"]


def test_truncation_resets(tmp_path):
    path = tmp_path / "e.jsonl"
    tailer = EventTailer(path)
    path.write_text("a\nb\nc\n")
    assert len(tailer.poll()) == 3
    path.write_text("fresh\n")  # rotated: new, smaller file
    assert tailer.poll() == ["fresh"]


def test_file_appearing_late(tmp_path):
    path = tmp_path / "e.jsonl"
    tailer = EventTailer(path)
    assert tailer.poll() == []
    path.write_text("hello\n")
    assert tailer.poll() == ["hello"]
