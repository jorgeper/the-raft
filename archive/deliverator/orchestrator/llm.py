"""Thin OpenRouter client — the chokepoint for every completion call.
Model routing, per-role key selection, budget attribution, and cost logging
all live here and only here.

Per-role capped keys: if `role_keys.json` exists (created by provision_keys.py),
each role uses its own budget-capped key. Otherwise everything falls back to the
single OPENROUTER_API_KEY.
"""
import os
import json
import csv
import pathlib
import datetime

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

_HERE = pathlib.Path(__file__).parent
_KEYFILE = _HERE / "role_keys.json"
ROLE_KEYS = json.loads(_KEYFILE.read_text()) if _KEYFILE.exists() else {}
_FALLBACK = os.environ.get("OPENROUTER_API_KEY")
_LOG = _HERE / "logs" / "costs.csv"

_clients: dict[str, OpenAI] = {}


def _client_for(role: str) -> OpenAI:
    if role not in _clients:
        _clients[role] = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=ROLE_KEYS.get(role) or _FALLBACK,
            default_headers={"X-Title": "deliverator"},
        )
    return _clients[role]


# --- cost accounting: in-memory tally for the loop's cap + CSV for the dashboard ---
_usd_spent = 0.0
_by_role: dict[str, float] = {}


def _log_cost(role, model, cost, usage):
    _LOG.parent.mkdir(exist_ok=True)
    new = not _LOG.exists()
    with _LOG.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["ts", "role", "model", "cost_usd",
                        "prompt_tokens", "completion_tokens"])
        w.writerow([datetime.datetime.now(datetime.UTC).isoformat(), role, model,
                    f"{cost:.6f}",
                    getattr(usage, "prompt_tokens", ""),
                    getattr(usage, "completion_tokens", "")])


def add_cost(role: str, model: str, cost: float):
    """For spend that doesn't flow through call() — e.g. the headless coder,
    which is metered on your Anthropic key. One set of books, two providers."""
    global _usd_spent
    _usd_spent += cost
    _by_role[role] = _by_role.get(role, 0.0) + cost
    _log_cost(role, model, cost, None)


def call(role: str, model: str, system: str, user: str, max_tokens: int = 4000) -> str:
    """One LLM turn, keyed by ROLE (so spend is capped + attributed per role).
    One system message + one user message in, text out. No conversation history —
    statelessness forces all memory into files you can inspect."""
    global _usd_spent
    resp = _client_for(role).chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        extra_body={"usage": {"include": True}},  # ask OpenRouter to return real cost
    )
    usage = getattr(resp, "usage", None)
    cost = float(getattr(usage, "cost", 0) or 0) if usage else 0.0
    _usd_spent += cost
    _by_role[role] = _by_role.get(role, 0.0) + cost
    _log_cost(role, model, cost, usage)
    return resp.choices[0].message.content


def spent() -> float:
    return _usd_spent


def by_role() -> dict:
    return dict(_by_role)
