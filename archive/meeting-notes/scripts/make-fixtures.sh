#!/usr/bin/env bash
# Generates speech test fixtures with the macOS `say` voice, 16 kHz mono WAV.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/tests/fixtures"
mkdir -p "$DIR"
gen() { # $1=voice $2=name $3=text
  say -v "$1" -o "$DIR/$2.aiff" "$3"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$DIR/$2.aiff" "$DIR/$2.wav"
  rm "$DIR/$2.aiff"
}
gen Samantha hello "Hello world, this is a test recording for the minutes application."
gen Samantha twoparts "This is the first sentence. [[slnc 900]] And after a pause, this is the second sentence."
# Two-speaker conversation segments (Samantha = Alice, Daniel = Bob).
gen Samantha alice-1 "Hello everyone, I think we should ship on Tuesday."
gen Daniel   bob-1   "I completely disagree, the tests are not ready yet."
gen Samantha alice-2 "Well, I am Alice and I say we ship it anyway."
gen Daniel   bob-2   "Fine, let us compromise on Thursday then."
echo "fixtures written to $DIR"
