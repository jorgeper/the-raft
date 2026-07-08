#!/usr/bin/env bash
# Create the label vocabulary the loop uses as its state machine.
# Run inside your project repo (needs gh authenticated). Idempotent (--force).
set -e
gh label create "agent:ready"           --color 0E8A16 --description "Queued for the agent loop"           --force
gh label create "agent:design-draft"    --color FBCA04 --description "Design doc being drafted/revised"    --force
gh label create "agent:design-approved" --color 0E8A16 --description "Human approved the design PR"        --force
gh label create "agent:coding"          --color 1D76DB --description "Coder agent working"                 --force
gh label create "agent:trivial"         --color C2E0C6 --description "Skip design; go straight to coding"  --force
gh label create "agent:code-review"     --color 1D76DB --description "PR under agent review"               --force
gh label create "agent:needs-human"     --color D93F0B --description "Parked — waiting on you"             --force
gh label create "agent:done"            --color 5319E7 --description "Merged / complete"                   --force
echo "Labels created. Green = ready to advance, yellow = design, blue = code, red = waiting on you, purple = done."
