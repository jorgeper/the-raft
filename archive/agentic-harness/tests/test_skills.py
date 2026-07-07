"""Skills: agentskills.io frontmatter validity for every shipped skill."""

from pathlib import Path

import pytest
import yaml

SKILLS_DIR = Path(__file__).resolve().parent.parent / ".claude" / "skills"
EXPECTED = {
    "spec-writing",
    "acceptance-criteria",
    "tdd-workflow",
    "run-and-verify",
    "code-review-rubric",
}


def _frontmatter(path: Path) -> dict:
    text = path.read_text()
    assert text.startswith("---\n"), f"{path}: missing frontmatter"
    _, front, body = text.split("---\n", 2)
    assert body.strip(), f"{path}: empty body"
    return yaml.safe_load(front)


def test_all_expected_skills_exist():
    found = {p.name for p in SKILLS_DIR.iterdir() if (p / "SKILL.md").is_file()}
    assert EXPECTED <= found


@pytest.mark.parametrize("skill", sorted(EXPECTED))
def test_skill_frontmatter(skill):
    front = _frontmatter(SKILLS_DIR / skill / "SKILL.md")
    # agentskills.io: name must match the parent directory, lowercase alnum + hyphens
    assert front["name"] == skill
    assert front["name"].replace("-", "").isalnum() and front["name"] == front["name"].lower()
    description = front.get("description", "")
    assert description and len(description) <= 1024
    assert "stub" not in description


@pytest.mark.parametrize("skill", sorted(EXPECTED))
def test_skill_body_is_substantial(skill):
    body = (SKILLS_DIR / skill / "SKILL.md").read_text()
    assert len(body.splitlines()) >= 20, f"{skill}: a skill should teach, not gesture"
