"""GoalLoop: harness-owned completion, plan discipline, guardrails, stop rules."""

import json
import subprocess

import pytest

from studio.loop import EXIT_CODES, EXIT_SIGNAL, Goal, GoalLoop, Plan
from studio.runtime.fake import FakeRuntime


@pytest.fixture
def workdir(tmp_path):
    """A tiny git repo the loop can fingerprint and commit in."""
    repo = tmp_path / "app"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True)
    (repo / ".gitignore").write_text(".loop/\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=repo, check=True)
    return repo


def plan_dict(tasks=None, gates=()):
    tasks = tasks or [
        {"id": "t1", "title": "make hello", "acceptance_command": "test -f hello.txt", "priority": 1},
        {"id": "t2", "title": "make world", "acceptance_command": "test -f world.txt", "priority": 2},
    ]
    return {"gates": list(gates), "tasks": tasks}


def write_plan(workdir, **kw):
    (workdir / ".loop").mkdir(exist_ok=True)
    (workdir / ".loop" / "plan.json").write_text(json.dumps(plan_dict(**kw)))


def commit_all(workdir, msg="work"):
    subprocess.run(["git", "add", "-A"], cwd=workdir, check=True)
    # check=False: repeated scripted iterations may have nothing new to commit
    subprocess.run(["git", "commit", "-qm", msg], cwd=workdir, check=False)


def make_task_solver(workdir, filename, signal=False):
    """A scripted 'agent' that creates a file, commits, optionally signals."""

    def solve(prompt):
        (workdir / filename).write_text("done\n")
        commit_all(workdir, f"add {filename}")
        return EXIT_SIGNAL if signal else f"created {filename}"

    return solve


def planner(workdir, **kw):
    def plan(prompt):
        assert "PLANNING MODE" in prompt
        write_plan(workdir, **kw)
        return "planned"

    return plan


# ------------------------------------------------------------------ happy path


def test_planning_iteration_produces_plan_then_tasks_run(workdir):
    rt = FakeRuntime(
        [
            planner(workdir),
            make_task_solver(workdir, "hello.txt"),
            make_task_solver(workdir, "world.txt", signal=True),
        ]
    )
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=6))
    assert result.reason == "verified"
    assert result.exit_code == 0
    plan = Plan.from_dict(json.loads((workdir / ".loop" / "plan.json").read_text()))
    assert all(t.passes for t in plan.tasks)
    canonical = (workdir / ".loop" / "plan.canonical.json").read_text()
    assert "hello.txt" in canonical


def test_one_task_per_iteration_targets_highest_priority_failing(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    rt = FakeRuntime([make_task_solver(workdir, "hello.txt")])
    GoalLoop(rt).run("build it", workdir, Goal(max_iterations=1))
    assert "[t1] make hello" in rt.prompts[0]
    assert "work ONLY this one" in rt.prompts[0]


def test_resume_continues_from_first_failing_task(workdir):
    tasks = plan_dict()["tasks"]
    tasks[0]["passes"] = True
    (workdir / "hello.txt").write_text("already there\n")
    commit_all(workdir)
    write_plan(workdir, tasks=tasks)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict(tasks=tasks)))
    rt = FakeRuntime([make_task_solver(workdir, "world.txt")])
    GoalLoop(rt).run("build it", workdir, Goal(max_iterations=1))
    assert "[t2] make world" in rt.prompts[0]


# ------------------------------------------------- harness-owned completion


def test_lying_agent_does_not_complete(workdir):
    """Flipping every `passes` flag and shouting EXIT_SIGNAL must not verify while a
    gate still fails — and the failure must land in progress.md and the next prompt."""
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))

    def liar(prompt):
        tasks = plan_dict()["tasks"]
        for t in tasks:
            t["passes"] = True
        (workdir / ".loop" / "plan.json").write_text(json.dumps({"gates": [], "tasks": tasks}))
        return EXIT_SIGNAL

    rt = FakeRuntime([liar, liar, liar, liar, liar, liar])
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=6))
    assert result.reason in ("thrash", "budget-exhausted")
    assert result.exit_code != 0
    progress = (workdir / ".loop" / "progress.md").read_text()
    assert "gates failing" in progress
    assert "hello.txt" in progress  # the failing acceptance command is recorded
    # feedback injection: iteration 2's prompt explains why iteration 1 didn't complete
    assert "## Why the previous iteration did not complete" in rt.prompts[1]
    assert "hello.txt" in rt.prompts[1]
    # and the lying flip was reverted by the harness
    plan = Plan.from_dict(json.loads((workdir / ".loop" / "plan.json").read_text()))
    assert not plan.tasks[0].passes


def test_exit_signal_alone_never_completes(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    rt = FakeRuntime([EXIT_SIGNAL] * 6)
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=6))
    assert result.reason != "verified"


def test_green_without_signal_takes_confirmation_iteration(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    rt = FakeRuntime(
        [
            make_task_solver(workdir, "hello.txt"),
            make_task_solver(workdir, "world.txt"),  # green but silent
            EXIT_SIGNAL,  # confirmation
        ]
    )
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=6))
    assert result.reason == "verified"
    assert result.iterations == 3
    assert "## Confirmation" in rt.prompts[2]


def test_uncommitted_work_blocks_verification(workdir):
    write_plan(workdir, tasks=[{"id": "t1", "acceptance_command": "test -f hello.txt"}])
    (workdir / ".loop" / "plan.canonical.json").write_text(
        json.dumps(plan_dict(tasks=[{"id": "t1", "acceptance_command": "test -f hello.txt"}]))
    )

    def sloppy(prompt):
        (workdir / "hello.txt").write_text("x")  # never commits (hello.txt untracked)
        return EXIT_SIGNAL

    rt = FakeRuntime([sloppy] * 6)
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=6))
    assert result.reason != "verified"


# ------------------------------------------------------------ plan integrity


def test_plan_tamper_is_restored(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))

    def tamperer(prompt):
        weak = plan_dict(tasks=[{"id": "t1", "title": "trivial", "acceptance_command": "true", "passes": True}])
        (workdir / ".loop" / "plan.json").write_text(json.dumps(weak))
        return "made it easier"

    rt = FakeRuntime([tamperer, make_task_solver(workdir, "hello.txt")])
    GoalLoop(rt).run("build it", workdir, Goal(max_iterations=2))
    plan = Plan.from_dict(json.loads((workdir / ".loop" / "plan.json").read_text()))
    assert len(plan.tasks) == 2  # dropped task restored
    assert plan.tasks[0].acceptance_command == "test -f hello.txt"  # weakening reverted


def test_test_count_drop_fails_gate(workdir):
    (workdir / "test_app.py").write_text("def test_a():\n    pass\n\ndef test_b():\n    pass\n")
    commit_all(workdir)
    tasks = [{"id": "t1", "acceptance_command": "true"}]
    write_plan(workdir, tasks=tasks)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict(tasks=tasks)))

    def deleter(prompt):
        (workdir / "test_app.py").write_text("def test_a():\n    pass\n")
        commit_all(workdir, "trim tests")
        return EXIT_SIGNAL

    rt = FakeRuntime([deleter] * 6)
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=6))
    assert result.reason != "verified"
    assert "test count dropped" in (workdir / ".loop" / "progress.md").read_text()
    assert "never delete or weaken tests" in (workdir / ".loop" / "guardrails.md").read_text()


# ------------------------------------------------------------- guardrails


def test_guardrail_appended_after_three_identical_failures(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    rt = FakeRuntime(["nothing"] * 6)

    def creep(prompt, _n=[0]):  # noqa: B006 — deliberate mutable counter
        _n[0] += 1
        (workdir / f"junk{_n[0]}.txt").write_text("x")
        commit_all(workdir, "junk")  # diffs each time so thrash doesn't fire first
        return "tried something"

    rt = FakeRuntime([creep] * 6)
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=4))
    guardrails = (workdir / ".loop" / "guardrails.md").read_text()
    assert "happened 3 times" in guardrails
    assert result.reason == "budget-exhausted"
    # guardrails are injected into subsequent prompts, at the end
    assert "Guardrails" in rt.prompts[-1]


# --------------------------------------------------------------- stop rules


def test_no_diff_circuit_breaker_exits_thrash(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    rt = FakeRuntime(["did nothing"] * 10)
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=10))
    assert result.reason == "thrash"
    assert result.exit_code == EXIT_CODES["thrash"] == 2
    assert result.iterations < 10  # tripped before the budget


def test_max_iterations_exits_budget_exhausted(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))

    def busy(prompt, _n=[0]):  # noqa: B006
        _n[0] += 1
        (workdir / f"f{_n[0]}").write_text("x")
        commit_all(workdir)
        return "working"

    rt = FakeRuntime([busy] * 3)
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=3))
    assert result.reason == "budget-exhausted"
    assert result.exit_code == 1


def test_wall_clock_budget(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    ticks = iter([0, 0, 91 * 60])

    def clock():
        return next(ticks, 92 * 60)

    rt = FakeRuntime(["x"] * 5)
    result = GoalLoop(rt, clock=clock).run("build it", workdir, Goal(max_iterations=5, max_minutes=90))
    assert result.reason == "budget-exhausted"


def test_needs_human_exits_escalated(workdir):
    write_plan(workdir)
    (workdir / ".loop" / "plan.canonical.json").write_text(json.dumps(plan_dict()))
    rt = FakeRuntime(["NEEDS_HUMAN: is the design spec final?"])
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=5))
    assert result.reason == "escalated"
    assert result.exit_code == 3
    assert "design spec final" in result.gate_report


# ------------------------------------------------------------- plan parsing


def test_invalid_plan_rejected():
    with pytest.raises(ValueError, match="tasks"):
        Plan.from_dict({"gates": []})
    with pytest.raises(ValueError, match="acceptance_command"):
        Plan.from_dict({"tasks": [{"id": "t1"}]})
    with pytest.raises(ValueError, match="unique"):
        Plan.from_dict(
            {"tasks": [{"id": "a", "acceptance_command": "x"}, {"id": "a", "acceptance_command": "y"}]}
        )


def test_planning_failure_injects_feedback(workdir):
    rt = FakeRuntime(["forgot to write the plan", "still nothing", "nope"])
    result = GoalLoop(rt).run("build it", workdir, Goal(max_iterations=3))
    assert result.reason in ("thrash", "budget-exhausted")
    assert "did not produce a valid .loop/plan.json" in rt.prompts[1]
