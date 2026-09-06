#!/usr/bin/env bash
# Create the Black Sun state labels in a GitHub repo.
# Usage: scripts/setup-github.sh owner/repo
set -euo pipefail

REPO="${1:?usage: setup-github.sh owner/repo}"

label() { # name color description
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force
}

# The pipeline (labels are the state machine — spec §4)
label "blacksun:backlog"              "ededed" "Filed, not yet picked up"
label "blacksun:prd:drafting"         "fbca04" "PRD agent is writing"
label "blacksun:prd:review"           "d93f0b" "PRD awaits YOUR review (blacksun approve)"
label "blacksun:prd:approved"         "0e8a16" "PRD approved by a human"
label "blacksun:design:drafting"      "fbca04" "Architect is designing"
label "blacksun:design:review"        "d93f0b" "Design awaits YOUR review (blacksun approve)"
label "blacksun:design:approved"      "0e8a16" "Design approved by a human"
label "blacksun:ready"                "0e8a16" "A coder may claim this"
label "blacksun:coding"               "1d76db" "GoalLoop in progress"
label "blacksun:pr:agent-review"      "5319e7" "Draft PR under agent review"
label "blacksun:pr:changes-requested" "5319e7" "Reviewers requested changes"
label "blacksun:pr:human-review"      "d93f0b" "Agent-approved; awaits YOUR merge"
label "blacksun:done"                 "0e8a16" "Merged and closed"
label "blacksun:needs-human"          "b60205" "Escalation — a human must decide"

# Kinds
label "kind:feature" "c2e0c6" "Feature request"
label "kind:bug"     "f9d0c4" "Bug (skips the PRD stage)"
label "kind:chore"   "ededed" "Chore"

echo "labels created in $REPO."
echo "next: set 'tracker: {kind: github, repo: $REPO}' in config/blacksun.yaml"
