#!/usr/bin/env bash
# Create the Agent Studio state labels in a GitHub repo.
# Usage: scripts/setup-github.sh owner/repo
set -euo pipefail

REPO="${1:?usage: setup-github.sh owner/repo}"

label() { # name color description
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force
}

# The pipeline (labels are the state machine — spec §4)
label "studio:backlog"              "ededed" "Filed, not yet picked up"
label "studio:prd:drafting"         "fbca04" "PRD agent is writing"
label "studio:prd:review"           "d93f0b" "PRD awaits YOUR review (studio approve)"
label "studio:prd:approved"         "0e8a16" "PRD approved by a human"
label "studio:design:drafting"      "fbca04" "Architect is designing"
label "studio:design:review"        "d93f0b" "Design awaits YOUR review (studio approve)"
label "studio:design:approved"      "0e8a16" "Design approved by a human"
label "studio:ready"                "0e8a16" "A coder may claim this"
label "studio:coding"               "1d76db" "GoalLoop in progress"
label "studio:pr:agent-review"      "5319e7" "Draft PR under agent review"
label "studio:pr:changes-requested" "5319e7" "Reviewers requested changes"
label "studio:pr:human-review"      "d93f0b" "Agent-approved; awaits YOUR merge"
label "studio:done"                 "0e8a16" "Merged and closed"
label "studio:needs-human"          "b60205" "Escalation — a human must decide"

# Kinds
label "kind:feature" "c2e0c6" "Feature request"
label "kind:bug"     "f9d0c4" "Bug (skips the PRD stage)"
label "kind:chore"   "ededed" "Chore"

echo "labels created in $REPO."
echo "next: set 'tracker: {kind: github, repo: $REPO}' in config/studio.yaml"
