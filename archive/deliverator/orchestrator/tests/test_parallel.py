"""Task collection: dedupe + stage precedence."""
from types import SimpleNamespace

from loop import collect_tasks


def _issue(n):
    return SimpleNamespace(number=n, title=f"issue {n}")


def h_design(issue):
    pass


def h_code(issue):
    pass


STAGES = [("agent:ready", h_design), ("agent:coding", h_code)]


def test_collect_tasks_one_task_per_issue():
    tasks = collect_tasks(STAGES, {"agent:ready": [_issue(1), _issue(2)],
                                   "agent:coding": [_issue(3)]})
    assert [(label, i.number) for label, _, i in tasks] == [
        ("agent:ready", 1), ("agent:ready", 2), ("agent:coding", 3)]


def test_collect_tasks_dedupes_by_issue_number_first_stage_wins():
    # issue 7 carries both labels (e.g. a half-finished manual flip) — it must
    # be dispatched exactly once, to the EARLIER stage in the table.
    tasks = collect_tasks(STAGES, {"agent:ready": [_issue(7)],
                                   "agent:coding": [_issue(7), _issue(8)]})
    assert [(h, i.number) for _, h, i in tasks] == [(h_design, 7), (h_code, 8)]


def test_collect_tasks_missing_labels_are_fine():
    assert collect_tasks(STAGES, {}) == []
