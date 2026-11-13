# Troubleshooting

*The system fails loudly and writes everything down. This is the map of where to
read, and what each failure shape means.*

## Where to look, in order

| Zoom | Artifact | Answers |
|---|---|---|
| 1 | `python -m studio status` | what state is everything in; what needs me |
| 2 | the item's comments (`gh issue view N --comments` or `cat .work/items/N.md`) | the narrative: specs, gate reports, reviews, escalation reports |
| 3 | `runs/<stamp>-<item>-<agent>/` | the verbatim prompt an agent saw and what it said back |
| 4 | worktree `.loop/` (`progress.md`, `plan.json`, `guardrails.md`) | the coder's iteration-by-iteration reality |
| 5 | `.agent-logs/` (`orchestrator.log`, `audit.jsonl`, `blocked.log`) | every tick, every tool call, every blocked command |

Golden rule: **read before touching.** Every failure below leaves a report; the fix
is usually in the inputs (spec, config, environment), rarely in the harness.

## Loop exits, decoded

The GoalLoop's exit reason arrives in the escalation comment and picks the fix
([mechanics](../architecture/05-goal-loop-internals.md)):

**`thrash` (same-error breaker)** — five identical gate failures. The loop was
told to do something it can't. Nine times in ten the acceptance criterion is
wrong: unrunnable as written, environment-dependent, or contradicting another.
Read the repeated failure in `progress.md`, fix the *criterion* (bounce the design
back), re-route to `ready`.

**`thrash` (no-diff breaker)** — three iterations without changing anything: the
model is confused rather than wrong. Check `runs/` — is the prompt missing
something obvious (a file it needs that's gitignored, a design comment that never
made it)? Also check `guardrails.md`: if a guardrail contradicts the plan, you've
found the pin.

**`budget-exhausted`** — real progress, ran out of room. Read `plan.json`: how many
tasks passed? Most passed → re-route to `ready`; it resumes from the first failing
task for free. Few passed → the item is too big; split it.

**`escalated`** — the agent asked a question. Answer it as a comment, re-route.
This is the system working, not failing.

## Common situations

**Item stuck, nothing dispatching.** Check the claim. A crashed run can leave one:
markdown → delete `.work/items/N.claim`; github → remove the `claimed-by:*` label.
Then check `run --dry-run --once` — it prints what would dispatch and why not.

**`failed` dispatches in the log, state unchanged.** A commenter runtime returned
empty/non-zero. By design nothing moved — retry happens next tick. Check the
runtime works at all: `claude -p "say hi"`. Rate limits and expired auth land here.

**Reviews stuck / degraded-review comments.** reviewer-b's CLI is missing.
Install codex, or set `approvals_required: 1`, or accept degraded mode — but
[decide, don't drift](../concepts/05-autonomy-and-safety.md).

**`config error: ...` on any command.** The message names the field
([reference](03-configuration.md)). After fixing, `python -m studio init` — and
remember prompts/skills changes need init to regenerate the subagent files.

**A command you expected was blocked.** `cat .agent-logs/blocked.log`. If guard.sh
blocked something you consider legitimate, that's a policy conversation with
yourself — loosen the hook knowingly, never casually
([the stack](../architecture/06-orchestrator-and-safety.md)).

**Worktree wedged** (rare: killed mid-run):

```sh
git -C ../your-app worktree list
git -C ../your-app worktree remove ../.studio-worktrees/N --force
git -C ../your-app branch -D agent/N-slug     # only if restarting the item clean
```

## Harness self-checks

When in doubt about the harness itself (after an upgrade, a config surgery, a weird
afternoon):

```sh
make verify     # 13 checks over the whole system
make demo       # the lifecycle on a throwaway repo — isolates harness from project
```

Green verify + green demo + your item still failing = the problem is your item's
spec or your project's environment. That triage taking thirty seconds instead of an
evening is most of what the harness is for.

## Asking for help (from yourself, later)

When you hit something novel, leave the trail the next reader needs: the exit
reason, the failing gate output from `progress.md`, and what fixed it — one line in
[DECISIONS.md](../../DECISIONS.md) or the reviewer journal. The
[weekly retro](02-daily-workflow.md) turns those lines into house rules.

---

[← Going live on GitHub](04-going-live-on-github.md) · [Index](../README.md) ·
[Part 4: Labs →](../labs/01-build-an-app.md)
