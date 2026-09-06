import json

from claude_usage.transcripts import parse_line

ASSISTANT_LINE = json.dumps(
    {
        "type": "assistant",
        "timestamp": "2026-09-05T18:00:00.000Z",
        "requestId": "req_1",
        "isSidechain": False,
        "message": {
            "id": "msg_1",
            "model": "claude-fable-5",
            "usage": {
                "input_tokens": 2,
                "output_tokens": 100,
                "cache_read_input_tokens": 5000,
                "cache_creation_input_tokens": 300,
                "cache_creation": {
                    "ephemeral_5m_input_tokens": 100,
                    "ephemeral_1h_input_tokens": 200,
                },
            },
        },
    }
)

PROMPT_LINE = json.dumps(
    {
        "type": "user",
        "timestamp": "2026-09-05T17:59:00.000Z",
        "isSidechain": False,
        "message": {"role": "user", "content": "hello"},
    }
)

TOOL_RESULT_LINE = json.dumps(
    {
        "type": "user",
        "timestamp": "2026-09-05T18:00:05.000Z",
        "isSidechain": False,
        "toolUseResult": {"stdout": "ok"},
        "message": {"role": "user", "content": [{"type": "tool_result"}]},
    }
)


def test_assistant_line_yields_usage_record():
    rec = parse_line(ASSISTANT_LINE)
    assert rec.kind == "usage"
    assert rec.model == "claude-fable-5"
    assert rec.input_tokens == 2
    assert rec.output_tokens == 100
    assert rec.cache_read_tokens == 5000
    assert rec.cache_create_5m_tokens == 100
    assert rec.cache_create_1h_tokens == 200
    assert rec.timestamp.year == 2026
    assert rec.dedup_key == ("msg_1", "req_1")


def test_user_prompt_line_yields_prompt_record():
    rec = parse_line(PROMPT_LINE)
    assert rec.kind == "prompt"


def test_tool_result_user_line_is_not_a_prompt():
    assert parse_line(TOOL_RESULT_LINE) is None


def test_garbage_and_irrelevant_lines_return_none():
    assert parse_line("not json{") is None
    assert parse_line(json.dumps({"type": "summary"})) is None
    assert parse_line(json.dumps({"type": "assistant", "message": {}})) is None
