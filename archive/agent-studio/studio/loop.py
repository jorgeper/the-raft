"""GoalLoop — the studio's /goal equivalent: a sophisticated Ralph loop.

The defining property: THE HARNESS OWNS COMPLETION. The model's word (flipping
passes flags, emitting EXIT_SIGNAL) is never sufficient — every claim is
re-verified by running the gates. All memory between iterations lives in files
under <workdir>/.loop/ (fresh model context every iteration).

Mechanisms and provenance: research/loop-engineering-research.md §4.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field, replace
from pathlib import Path

from studio.events import NullEventLog, OutputCoalescer
from studio.execution import CommandExecutor
from studio.runtime.base import ModelRuntime

EXIT_CODES = {"verified": 0, "budget-exhausted": 1, "thrash": 2, "escalated": 3}

EXIT_SIGNAL = "EXIT_SIGNAL: COMPLETE"
NEEDS_HUMAN = "NEEDS_HUMAN:"

_PROGRESS_HEADER = "# Progress log\n\n## Codebase Patterns\n\n(none yet)\n\n## Iterations\n"
_GUARDRAILS_HEADER = (
    "# Guardrails\n\nAppend-only signs. Format: Trigger / Instruction / Reason / Provenance.\n"
)

PLANNING_INSTRUCTIONS = """\
## PLANNING MODE — plan only. Do NOT implement anything.

Decompose the design spec's acceptance criteria into ordered tasks and write them to
`.loop/plan.json` (create the .loop directory if needed) as JSON:

{"gates": ["<shell command>", ...],            // standing quality gates: test, lint, smoke
 "tasks": [{"id": "t1", "title": "...", "steps": ["..."],
            "acceptance_command": "<shell command that exits 0 when this task is done>",
            "priority": 1, "passes": false, "notes": ""}, ...]}

Every acceptance_command must be machine-checkable. Do not write any other file.
"""


@dataclass(frozen=True)
class Task:
    id: str
    title: str
    acceptance_command: str
    steps: tuple[str, ...] = ()
    priority: int = 100
    passes: bool = False
    notes: str = ""


@dataclass(frozen=True)
class Plan:
    gates: tuple[str, ...]
    tasks: tuple[Task, ...]

    @staticmethod
    def from_dict(raw: dict) -> Plan:
        if not isinstance(raw, dict) or not isinstance(raw.get("tasks"), list) or not raw["tasks"]:
            raise ValueError("plan must be a mapping with a non-empty 'tasks' list")
        tasks = []
        for i, t in enumerate(raw["tasks"]):
            if not t.get("id") or not t.get("acceptance_command"):
                raise ValueError(f"task {i}: 'id' and 'acceptance_command' are required")
            tasks.append(
                Task(
                    id=str(t["id"]),
                    title=str(t.get("title", t["id"])),
                    acceptance_command=str(t["acceptance_command"]),
                    steps=tuple(t.get("steps", ())),
                    priority=int(t.get("priority", 100)),
                    passes=bool(t.get("passes", False)),
                    notes=str(t.get("notes", "")),
                )
            )
        if len({t.id for t in tasks}) != len(tasks):
            raise ValueError("task ids must be unique")
        return Plan(gates=tuple(str(g) for g in raw.get("gates", ())), tasks=tuple(tasks))

    def to_dict(self) -> dict:
        return {
            "gates": list(self.gates),
            "tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "steps": list(t.steps),
                    "acceptance_command": t.acceptance_command,
                    "priority": t.priority,
                    "passes": t.passes,
                    "notes": t.notes,
                }
                for t in self.tasks
            ],
        }

    def next_task(self) -> Task | None:
        pending = [t for t in self.tasks if not t.passes]
        return min(pending, key=lambda t: t.priority) if pending else None


@dataclass(frozen=True)
class Goal:
    gates: tuple[str, ...] = ()  # extra harness-imposed gates, merged with the plan's
    max_iterations: int = 10
    max_minutes: int = 90


@dataclass
class LoopResult:
    reason: str
    iterations: int
    wall_time_s: float = 0.0
    gate_report: str = ""
    last_feedback: str = ""

    @property
    def exit_code(self) -> int:
        return EXIT_CODES.get(self.reason, 1)


@dataclass
class _State:
    """Mutable bookkeeping across iterations (harness-side, never model-side)."""

    feedback: str = ""
    same_error: str = ""
    same_error_count: int = 0
    no_diff_count: int = 0
    last_fingerprint: str = ""
    max_green_tests: int = 0
    awaiting_signal: bool = False
    guardrail_errors: dict[str, int] = field(default_factory=dict)


class GoalLoop:
    def __init__(
        self,
        runtime: ModelRuntime,
        *,
        executor: CommandExecutor | None = None,
        agent: str | None = None,
        clock=time.monotonic,
        run_timeout_s: int = 3600,
        events=None,
        streaming: bool = False,
    ) -> None:
        self.runtime = runtime
        self.executor = executor or CommandExecutor()
        self.agent = agent
        self.clock = clock
        self.run_timeout_s = run_timeout_s
        self.streaming = streaming
        # The orchestrator rebinds this per dispatch (events.bound(item=..., agent=...)).
        self.events = events or NullEventLog()
        # Optional harness hook fed each iteration's raw output (reflection harvest).
        self.output_hook = None

    # ---------------------------------------------------------------- files

    def _loop_dir(self, workdir: Path) -> Path:
        d = workdir / ".loop"
        d.mkdir(exist_ok=True)
        for name, header in (("progress.md", _PROGRESS_HEADER), ("guardrails.md", _GUARDRAILS_HEADER)):
            if not (d / name).exists():
                (d / name).write_text(header)
        return d

    def _read_plan(self, workdir: Path) -> Plan | None:
        path = workdir / ".loop" / "plan.json"
        if not path.is_file():
            return None
        try:
            return Plan.from_dict(json.loads(path.read_text()))
        except (ValueError, json.JSONDecodeError):
            return None

    def _write_plan(self, workdir: Path, plan: Plan, canonical: bool = False) -> None:
        name = "plan.canonical.json" if canonical else "plan.json"
        (workdir / ".loop" / name).write_text(json.dumps(plan.to_dict(), indent=2))

    def _reconcile_plan(self, workdir: Path, canonical: Plan) -> Plan:
        """Restore the canonical plan, keeping only the agent's `notes`.

        `passes` is HARNESS-OWNED: the canonical copy records what the harness
        itself verified. An agent flipping flags in plan.json changes nothing —
        that is the crux of harness-owned completion (spec §6.3).
        """
        current = self._read_plan(workdir)
        current_by_id = {t.id: t for t in current.tasks} if current else {}
        merged_tasks = tuple(
            replace(t, notes=current_by_id[t.id].notes) if t.id in current_by_id else t
            for t in canonical.tasks
        )
        merged = Plan(gates=canonical.gates, tasks=merged_tasks)
        self._write_plan(workdir, merged)
        return merged

    def _append_progress(self, workdir: Path, text: str) -> None:
        with (workdir / ".loop" / "progress.md").open("a") as fh:
            fh.write(text.rstrip() + "\n")

    def _append_guardrail(self, workdir: Path, trigger: str, instruction: str, reason: str) -> None:
        entry = (
            f"\n- **Trigger:** {trigger}\n  **Instruction:** {instruction}\n"
            f"  **Reason:** {reason}\n  **Provenance:** harness (auto)\n"
        )
        with (workdir / ".loop" / "guardrails.md").open("a") as fh:
            fh.write(entry)
        self.events.emit("guardrail_added", trigger=trigger)

    # ---------------------------------------------------------------- git & gates

    def _sh(self, command: str, workdir: Path):
        return self.executor.run(["sh", "-c", command], cwd=workdir, timeout_s=self.run_timeout_s)

    def _git_clean(self, workdir: Path) -> bool:
        return self._sh("git status --porcelain", workdir).stdout.strip() == ""

    def _fingerprint(self, workdir: Path) -> str:
        head = self._sh("git rev-parse HEAD 2>/dev/null", workdir).stdout.strip()
        dirty = self._sh("git status --porcelain 2>/dev/null", workdir).stdout
        return f"{head}|{hash(dirty)}"

    def _count_tests(self, workdir: Path) -> int:
        pattern = re.compile(r"^\s*def test_", re.MULTILINE)
        count = 0
        for path in workdir.rglob("*.py"):
            if ".loop" in path.parts or ".git" in path.parts:
                continue
            if path.name.startswith("test_") or path.name.endswith("_test.py"):
                try:
                    count += len(pattern.findall(path.read_text()))
                except OSError:
                    continue
        return count

    def _run_gates(self, commands: tuple[str, ...], workdir: Path) -> tuple[bool, str, str]:
        """Returns (all_ok, report, first_failure_feedback)."""
        report_lines, failure = [], ""
        for cmd in commands:
            result = self._sh(cmd, workdir)
            status = "PASS" if result.ok else f"FAIL (exit {result.returncode})"
            report_lines.append(f"$ {cmd}\n{status}")
            combined = (result.stdout + "\n" + result.stderr).strip()
            self.events.emit("gate_result", command=cmd, ok=result.ok, gate_tail=combined)
            if not result.ok and not failure:
                tail = "\n".join(combined.splitlines()[-50:])
                failure = f"$ {cmd}\nexit {result.returncode}\n{tail}"
        return not failure, "\n".join(report_lines), failure

    # ---------------------------------------------------------------- prompt

    def _build_prompt(self, base: str, workdir: Path, plan: Plan | None, state: _State) -> str:
        parts = [base]
        parts.append(
            "\n## Orientation ritual (do this FIRST)\n"
            "Read `git log --oneline -10`, `.loop/plan.json`, and the tail of "
            "`.loop/progress.md`. Run the standing gates to see where things stand "
            "BEFORE writing anything new.\n"
        )
        if plan is None:
            parts.append(PLANNING_INSTRUCTIONS)
        else:
            task = plan.next_task()
            if task is not None:
                steps = "".join(f"\n  - {s}" for s in task.steps)
                parts.append(
                    f"\n## Current task (work ONLY this one)\n"
                    f"[{task.id}] {task.title}{steps}\n"
                    f"Acceptance: `{task.acceptance_command}` must exit 0.\n"
                    "One task = one iteration = one commit. When your own run of the "
                    "acceptance command and the gates is green, set this task's `passes` "
                    "to true in .loop/plan.json, commit, and append a progress entry with "
                    "learnings. Only mutate `passes` and `notes` in plan.json.\n"
                    f"When ALL tasks pass and gates are green, emit `{EXIT_SIGNAL}`.\n"
                    f"If truly blocked, emit `{NEEDS_HUMAN} <question>` and stop.\n"
                )
            elif state.awaiting_signal:
                parts.append(
                    "\n## Confirmation\nEvery task passes and gates are green. Do a final "
                    f"review; if you agree the goal is met, emit `{EXIT_SIGNAL}`.\n"
                )
        if state.feedback:
            parts.append(f"\n## Why the previous iteration did not complete\n{state.feedback}\n")
        progress = workdir / ".loop" / "progress.md"
        if progress.is_file():
            tail = "\n".join(progress.read_text().splitlines()[-40:])
            parts.append(f"\n## Progress (tail)\n{tail}\n")
        guardrails = workdir / ".loop" / "guardrails.md"
        if guardrails.is_file():
            parts.append(f"\n{guardrails.read_text()}\n")  # last words win
        return "\n".join(parts)

    # ---------------------------------------------------------------- the loop

    def run(self, base_prompt: str, workdir: Path, goal: Goal) -> LoopResult:
        workdir = Path(workdir)
        self._loop_dir(workdir)
        start = self.clock()
        state = _State()
        canonical = self._read_canonical(workdir)
        state.max_green_tests = self._count_tests(workdir) if canonical else 0
        self.events.emit(
            "loop_start", workdir=str(workdir),
            max_iterations=goal.max_iterations, max_minutes=goal.max_minutes,
            tasks_total=len(canonical.tasks) if canonical else 0,
            tasks_passed=sum(t.passes for t in canonical.tasks) if canonical else 0,
        )

        for iteration in range(1, goal.max_iterations + 1):
            if (self.clock() - start) / 60 >= goal.max_minutes:
                return self._finish(workdir, state, "budget-exhausted", iteration - 1, start,
                                    f"wall clock exceeded {goal.max_minutes} minutes")

            canonical = self._read_canonical(workdir) or canonical  # _set_pass persists here
            plan = self._reconcile_plan(workdir, canonical) if canonical else None
            current = plan.next_task() if plan else None
            self.events.emit(
                "iteration_start", n=iteration,
                task_id=current.id if current else None,
                task_title=current.title if current else None,
            )
            prompt = self._build_prompt(base_prompt, workdir, plan, state)
            self.events.emit(
                "runtime_start", runtime=self.runtime.name, run_dir=None,
                prompt_chars=len(prompt),
            )
            coalescer = OutputCoalescer(self.events) if self.streaming else None
            result = self.runtime.run(
                prompt, cwd=workdir, timeout_s=self.run_timeout_s, agent=self.agent,
                on_output=coalescer.feed if coalescer else None,
            )
            if coalescer is not None:
                coalescer.close()
            self.events.emit(
                "runtime_end", exit_code=result.exit_code,
                duration_s=round(result.duration_s, 2), output_tail=result.output,
            )
            if self.output_hook is not None:
                self.output_hook(result.output)

            if NEEDS_HUMAN in result.output:
                question = result.output.split(NEEDS_HUMAN, 1)[1].strip().splitlines()[0:1]
                return self._finish(workdir, state, "escalated", iteration, start,
                                    f"agent escalated: {question[0] if question else '(no question)'}")

            if canonical is None:  # this was the planning iteration
                plan = self._read_plan(workdir)
                if plan is None:
                    state.feedback = (
                        "planning iteration did not produce a valid .loop/plan.json "
                        "(missing, unparseable, or empty tasks). Write it exactly as specified."
                    )
                    self._append_progress(workdir, f"\n### iter {iteration} (planning)\nFAILED: no valid plan.json")
                    self._register_error(workdir, state, "invalid plan.json")
                    if self._budgets_blown(state):
                        return self._finish(workdir, state, "thrash", iteration, start, state.feedback)
                    continue
                canonical = plan
                self._write_plan(workdir, canonical, canonical=True)
                state.max_green_tests = self._count_tests(workdir)
                self._append_progress(workdir, f"\n### iter {iteration} (planning)\nplan.json created: "
                                      f"{len(plan.tasks)} tasks, {len(plan.gates)} gates")
                state.feedback = ""
                continue

            plan = self._reconcile_plan(workdir, canonical)
            verdict = self._verify(workdir, plan, goal, state, iteration, result.output)
            if verdict is not None:
                return self._finish(workdir, state, verdict, iteration, start, state.feedback)

        return self._finish(workdir, state, "budget-exhausted", goal.max_iterations, start,
                            f"max_iterations ({goal.max_iterations}) reached")

    # ---------------------------------------------------------------- verification

    def _read_canonical(self, workdir: Path) -> Plan | None:
        path = workdir / ".loop" / "plan.canonical.json"
        if path.is_file():
            try:
                return Plan.from_dict(json.loads(path.read_text()))
            except (ValueError, json.JSONDecodeError):
                return None
        return None

    def _verify(self, workdir, plan, goal, state, iteration, output) -> str | None:
        task = plan.next_task()  # after reconcile: next task the AGENT claims is failing
        gates = tuple(dict.fromkeys(plan.gates + goal.gates))
        commands = gates if task is None else (task.acceptance_command, *gates)
        ok, report, failure = self._run_gates(commands, workdir)

        # Test-integrity ratchet: adding tests is fine, deleting previously-green ones is not.
        tests_now = self._count_tests(workdir)
        if ok and tests_now < state.max_green_tests:
            ok = False
            failure = (
                f"test count dropped from {state.max_green_tests} to {tests_now} — "
                "tests may be added, never deleted"
            )
            self._append_guardrail(workdir, "test count dropped", "Restore the deleted tests; never delete or weaken tests to pass a gate.", "spec §6.3 test-integrity")

        entry = [f"\n### iter {iteration}" + (f" — task {task.id}" if task else " — confirmation")]
        entry.append(report)

        if not ok:
            # Harness overrides any lying `passes` flip for the current task.
            if task is not None:
                self._set_pass(workdir, plan, task.id, False)
            state.feedback = failure
            entry.append(f"RESULT: gates failing\n{failure}")
            self._append_progress(workdir, "\n".join(entry))
            self._register_error(workdir, state, failure)
            self._track_diff(workdir, state)
            if self._budgets_blown(state):
                return "thrash"
            return None

        # Gates green. Promote the current task on the harness's own evidence.
        state.max_green_tests = max(state.max_green_tests, tests_now)
        if task is not None:
            plan = self._set_pass(workdir, plan, task.id, True)
            self.events.emit(
                "task_passed", task_id=task.id,
                tasks_passed=sum(t.passes for t in plan.tasks), tasks_total=len(plan.tasks),
            )
        state.same_error, state.same_error_count = "", 0
        self._track_diff(workdir, state)

        if plan.next_task() is None:
            if not self._git_clean(workdir):
                state.feedback = "all gates pass but the worktree is dirty — commit your work"
                entry.append("RESULT: green but uncommitted work remains")
                self._append_progress(workdir, "\n".join(entry))
                return "thrash" if self._budgets_blown(state) else None
            if EXIT_SIGNAL in output:
                entry.append("RESULT: verified — all tasks pass, gates green, worktree clean")
                self._append_progress(workdir, "\n".join(entry))
                return "verified"
            state.awaiting_signal = True
            state.feedback = ""
            entry.append("RESULT: green — awaiting explicit EXIT_SIGNAL confirmation")
            self._append_progress(workdir, "\n".join(entry))
            return None

        state.feedback = ""
        entry.append(f"RESULT: task {task.id} verified green; moving on")
        self._append_progress(workdir, "\n".join(entry))
        return None

    def _set_pass(self, workdir: Path, plan: Plan, task_id: str, value: bool) -> Plan:
        tasks = tuple(replace(t, passes=value) if t.id == task_id else t for t in plan.tasks)
        updated = Plan(gates=plan.gates, tasks=tasks)
        self._write_plan(workdir, updated)
        # `passes` state is agent-visible progress; keep the canonical copy in sync so
        # reconcile doesn't resurrect stale flags (only structure is immutable).
        canonical = self._read_canonical(workdir)
        if canonical:
            canon_tasks = tuple(
                replace(t, passes=value) if t.id == task_id else t for t in canonical.tasks
            )
            self._write_plan(workdir, Plan(gates=canonical.gates, tasks=canon_tasks), canonical=True)
        return updated

    def _register_error(self, workdir: Path, state: _State, failure: str) -> None:
        key = failure.strip().splitlines()[0][:200] if failure.strip() else "unknown"
        if key == state.same_error:
            state.same_error_count += 1
        else:
            state.same_error, state.same_error_count = key, 1
        state.guardrail_errors[key] = state.guardrail_errors.get(key, 0) + 1
        if state.guardrail_errors[key] == 3:
            self._append_guardrail(
                workdir,
                key,
                "This exact failure has now happened 3 times. Stop repeating the same "
                "approach — re-read the spec, inspect the actual error output, and try a "
                "substantially different strategy.",
                "auto-appended on 3rd identical gate failure",
            )

    def _track_diff(self, workdir: Path, state: _State) -> None:
        fp = self._fingerprint(workdir)
        if fp == state.last_fingerprint:
            state.no_diff_count += 1
        else:
            state.no_diff_count = 0
        state.last_fingerprint = fp

    def _budgets_blown(self, state: _State) -> bool:
        return state.no_diff_count >= 3 or state.same_error_count >= 5

    def _finish(self, workdir, state, reason, iterations, start, detail) -> LoopResult:
        wall = self.clock() - start
        self._append_progress(
            workdir, f"\n### loop exit\nreason: {reason} after {iterations} iterations — {detail}"
        )
        self.events.emit(
            "loop_exit", reason=reason, iterations=iterations, wall_time_s=round(wall, 2)
        )
        return LoopResult(
            reason=reason,
            iterations=iterations,
            wall_time_s=wall,
            gate_report=detail,
            last_feedback=state.feedback,
        )
