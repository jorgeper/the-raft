"""Phone front-end for the loop (Guide 5). Polls Telegram in a background thread
and maps chat actions onto the same gh.py operations the loop uses. Locked to one
chat id. Import-safe: if TELEGRAM_* aren't set, everything no-ops and the loop runs
normally without it."""
import os
import json
import time
import csv
import threading
import pathlib
import datetime

import httpx
from dotenv import load_dotenv

import gh

load_dotenv()

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
CHAT_ID = str(os.environ.get("TELEGRAM_CHAT_ID") or "")
API = f"https://api.telegram.org/bot{TOKEN}" if TOKEN else None
PENDING = pathlib.Path(__file__).parent / "pending.json"
COSTS = pathlib.Path(__file__).parent / "logs" / "costs.csv"


def configured() -> bool:
    return bool(TOKEN and CHAT_ID)


# ---- pending-gate state: written by the loop, read by the bot ----
def _read() -> dict:
    return json.loads(PENDING.read_text()) if PENDING.exists() else {}


def _write(d: dict):
    PENDING.write_text(json.dumps(d, indent=2))


def set_pending(issue_number, kind, next_label=None, pr_url=None):
    """Called by the loop when it parks an issue at a human gate.
    kind: 'design' | 'design-final' | 'code'. next_label: label an approval applies."""
    d = _read()
    d[str(issue_number)] = {"kind": kind, "next_label": next_label,
                            "pr_url": pr_url, "notified": False}
    _write(d)


def clear_pending(issue_number):
    d = _read()
    d.pop(str(issue_number), None)
    _write(d)


# ---- telegram send helpers (no-op if not configured) ----
def _send(text, buttons=None):
    if not configured():
        return
    body = {"chat_id": CHAT_ID, "text": text, "parse_mode": "Markdown"}
    if buttons:
        body["reply_markup"] = {"inline_keyboard": buttons}
    try:
        httpx.post(f"{API}/sendMessage", json=body, timeout=30)
    except Exception as e:
        print("bot send error:", e)


def notify(text, buttons=None):
    _send(text, buttons)


def notify_pending():
    """Push a notification for any issue newly parked at a gate."""
    if not configured():
        return
    d = _read()
    changed = False
    for num, info in d.items():
        if info.get("notified"):
            continue
        kind = info["kind"]
        if kind in ("design", "design-final"):
            label = ("Approve design → reviewers" if kind == "design"
                     else "Approve → start coding")
            buttons = [
                [{"text": f"✅ {label}", "callback_data": f"approve:{num}"}],
                [{"text": "✏️ Request changes", "callback_data": f"changes:{num}"}],
            ]
            if info.get("pr_url"):
                buttons.append([{"text": "🔗 Open design PR", "url": info["pr_url"]}])
            _send(f"*Issue #{num}* — design ready for your review.", buttons)
        else:  # code gate: honest merge — link the PR, do not auto-merge
            btn = ([[{"text": "🔗 Open PR to review & merge", "url": info["pr_url"]}]]
                   if info.get("pr_url") else None)
            _send(f"*Issue #{num}* — implementation validated & reviewed. "
                  f"Open the PR to review and merge.", btn)
        info["notified"] = True
        changed = True
    if changed:
        _write(d)


# ---- command handling ----
def _handle_message(msg):
    if str(msg["chat"]["id"]) != CHAT_ID:
        return  # not you — ignore
    text = (msg.get("text") or "").strip()
    if text.startswith("/new "):
        brief = text[5:].strip()
        issue = gh.repo.create_issue(title=brief[:60], body=brief,
                                      labels=["agent:ready"])
        _send(f"📥 Filed issue #{issue.number}: {issue.title}")
    elif text.startswith("/say "):
        parts = text[5:].split(" ", 1)
        if len(parts) == 2 and parts[0].isdigit():
            gh.comment(int(parts[0]), f"(from phone) {parts[1]}")
            _send(f"💬 Commented on #{parts[0]}.")
        else:
            _send("Usage: `/say <issue#> <message>`")
    elif text.startswith("/status"):
        lines = []
        for lbl in ["agent:ready", "agent:coding", "agent:code-review",
                    "agent:needs-human"]:
            for i in gh.issues_with_label(lbl):
                lines.append(f"#{i.number} `{lbl.split(':')[1]}` {i.title[:40]}")
        _send("*In flight:*\n" + ("\n".join(lines) if lines else "_nothing active_"))
    elif text.startswith("/spend"):
        total = today = 0.0
        d = datetime.datetime.utcnow().date().isoformat()
        if COSTS.exists():
            for r in csv.DictReader(COSTS.open()):
                c = float(r["cost_usd"])
                total += c
                if r["ts"][:10] == d:
                    today += c
        _send(f"💸 Today: ${today:.3f}   |   All-time: ${total:.3f}")
    else:
        _send("Commands: `/new <brief>`, `/say <#> <msg>`, `/status`, `/spend`")


def _handle_callback(cq):
    if str(cq["from"]["id"]) != CHAT_ID:
        return
    action, num = cq["data"].split(":")
    info = _read().get(num, {})
    if action == "approve":
        if info.get("next_label"):
            gh.set_label(int(num), info["next_label"], ["agent:needs-human"])
        clear_pending(int(num))
        _answer(cq["id"], "Approved ✅")
        _edit(cq["message"], f"✅ Issue #{num}: approved, loop continuing.")
    elif action == "changes":
        gh.set_label(int(num), "agent:design-draft", ["agent:needs-human"])
        clear_pending(int(num))
        _answer(cq["id"], "Sent back")
        _edit(cq["message"],
              f"✏️ Issue #{num}: send `/say {num} <feedback>`, then it redrafts.")


def _answer(cq_id, text):
    try:
        httpx.post(f"{API}/answerCallbackQuery",
                   json={"callback_query_id": cq_id, "text": text}, timeout=30)
    except Exception:
        pass


def _edit(message, text):
    try:
        httpx.post(f"{API}/editMessageText",
                   json={"chat_id": message["chat"]["id"],
                         "message_id": message["message_id"],
                         "text": text, "parse_mode": "Markdown"}, timeout=30)
    except Exception:
        pass


# ---- long-poll loop (own daemon thread) ----
def _poll_forever():
    offset = None
    while True:
        try:
            params = {"timeout": 30}
            if offset:
                params["offset"] = offset
            r = httpx.get(f"{API}/getUpdates", params=params, timeout=40)
            for upd in r.json().get("result", []):
                offset = upd["update_id"] + 1
                if "message" in upd:
                    _handle_message(upd["message"])
                elif "callback_query" in upd:
                    _handle_callback(upd["callback_query"])
        except Exception as e:
            print("bot error:", e)
            time.sleep(5)


def start():
    if not configured():
        print("Telegram bot not configured (set TELEGRAM_* in .env to enable). "
              "Loop runs without it.")
        return
    threading.Thread(target=_poll_forever, daemon=True).start()
    _send("🤖 Agent loop bot online. `/status` to see what's cooking.")
