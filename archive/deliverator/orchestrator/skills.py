"""Minimal skill loader for completion-call roles: inject a skill's body only
when the issue text matches its triggers (progressive disclosure, done the
orchestrator way).

The headless Claude Code coder does NOT need this — it reads .claude/skills/
natively from its checkout and fires skills by their description, with
`allowed-tools` enforced by the harness. This loader exists for the OpenRouter
roles, which receive text and can only return text.
"""
import pathlib
import re

SKILLS_DIR = pathlib.Path(__file__).resolve().parents[1] / ".claude" / "skills"


def load(name: str) -> str:
    """Return a skill's instructions with the YAML frontmatter stripped."""
    body = (SKILLS_DIR / name / "SKILL.md").read_text()
    return re.sub(r"^---.*?---\n", "", body, flags=re.S)


# role -> [(skill_name, trigger_keywords)].  ("",) matches everything (always fires).
ROLE_SKILLS = {
    "design": [
        ("design-doc", ("design", "architecture", "new app", "feature", "spec")),
    ],
    "review_security": [
        ("oauth-security-checklist",
         ("oauth", "login", "google", "auth", "session")),
    ],
    "review_correctness": [
        ("acceptance-criteria-audit", ("",)),   # always applies
    ],
    "coder": [
        # Only used in one-shot fallback mode; the headless coder loads skills itself.
        ("flask-conventions", ("flask", "route", "endpoint", "app", "blueprint")),
        ("run-inner-loop", ("",)),
    ],
}


def skills_for(role: str, issue_text: str) -> str:
    out = []
    for name, triggers in ROLE_SKILLS.get(role, []):
        if any(t in issue_text.lower() for t in triggers):
            try:
                out.append(load(name))
            except FileNotFoundError:
                pass
    return "\n\n---\n\n".join(out)
