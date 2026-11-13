import json

from claude_usage.scanner import ScanState, scan_transcripts


def make_line(msg_id, req_id, out=10):
    return json.dumps(
        {
            "type": "assistant",
            "timestamp": "2026-09-05T18:00:00.000Z",
            "requestId": req_id,
            "message": {
                "id": msg_id,
                "model": "claude-fable-5",
                "usage": {"input_tokens": 1, "output_tokens": out},
            },
        }
    )


def test_incremental_scan_only_reads_new_lines(tmp_path):
    proj = tmp_path / "projects" / "p1"
    proj.mkdir(parents=True)
    f = proj / "session.jsonl"
    f.write_text(make_line("m1", "r1") + "\n")

    state = ScanState()
    records = scan_transcripts(tmp_path / "projects", state)
    assert len(records) == 1
    assert records[0].source == f  # session identity for per-session stats

    with f.open("a") as fh:
        fh.write(make_line("m2", "r2") + "\n")
    records2 = scan_transcripts(tmp_path / "projects", state)
    assert len(records2) == 1  # only the new line

    assert scan_transcripts(tmp_path / "projects", state) == []


def test_duplicate_message_ids_are_deduped_across_files(tmp_path):
    proj = tmp_path / "projects" / "p1"
    proj.mkdir(parents=True)
    (proj / "a.jsonl").write_text(make_line("m1", "r1") + "\n")
    (proj / "b.jsonl").write_text(make_line("m1", "r1") + "\n")  # continued session copy

    records = scan_transcripts(tmp_path / "projects", ScanState())
    assert len(records) == 1
