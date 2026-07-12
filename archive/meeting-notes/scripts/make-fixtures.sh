#!/usr/bin/env bash
# Generates speech test fixtures with the macOS `say` voice, 16 kHz mono WAV.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/tests/fixtures"
mkdir -p "$DIR"
gen() { # $1=name $2=text
  say -v Samantha -o "$DIR/$1.aiff" "$2"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$DIR/$1.aiff" "$DIR/$1.wav"
  rm "$DIR/$1.aiff"
}
gen hello "Hello world, this is a test recording for the minutes application."
gen twoparts "This is the first sentence. [[slnc 900]] And after a pause, this is the second sentence."
echo "fixtures written to $DIR"
