# SPEC3: Numshub — live transcription in the overlay

An increment over SPEC.md and SPEC2.md (both stay authoritative elsewhere).
While recording, the overlay shows the words as they're spoken — text above
the waveform — using incremental re-transcription ("Option A"): no new engine,
no new model family.

## 1. Setting (FR-L1)

- New setting `live_transcription: bool`, **default ON**, in Settings →
  General ("Live transcription — show your words in the overlay as you
  speak"). Client-owned; persists like every other setting.
- OFF must restore today's exact behavior: compact pill, waveform only,
  nothing transcribed until you stop.

## 2. Live loop (FR-L2, Rust)

- While recording with the setting on, a live pass runs every ~1 s: snapshot
  the audio captured so far (the recorder gains a non-draining snapshot;
  capture itself must not hiccup), resample, transcribe through the SAME warm
  engine used at stop, and emit the raw text to the overlay as
  `stream-text` payload `{ text: string }`.
- **Never compromise the final result**: the stop path is authoritative and
  unchanged (full transcription → cleanup → optional enhancement → paste).
  If a live pass is in flight when the user stops, the stop path waits for
  the engine lock like any other caller — no cancellation complexity, no
  partial-result reuse.
- **Perf guard**: measure each live pass. If a pass takes longer than 60% of
  the current interval, stretch the interval (×1.5, capped at 4 s) and log
  once; recover toward 1 s when passes get fast again. Slow hardware
  degrades to fewer updates, never to a broken recording.
- The live loop must not run when: setting off, no active model, or the
  engine failed to load (the recording continues waveform-only).

## 3. Overlay (FR-L3)

- Recording state with live mode gains a taller pill (~420×110): a text
  region ABOVE the waveform, waveform and timer kept below at their current
  size. The `show-overlay` payload grows to `{ state, live: boolean }` so the
  overlay sizes itself; the Rust side picks the window size per state+mode.
- **Neat text treatment (the signature)**: stabilized text renders solid;
  the still-changing tail renders dimmed (~55% opacity). Newest words are
  always visible — the region keeps the tail in view (scroll pinned to the
  end), older words fade out at the top edge with a mask. Font: the app
  sans at 14–15px, max 3 lines visible. Respect reduced-motion.
- Stabilization is a pure frontend function (FR-L4). The overlay renders
  exactly `stable + " " + tentative`.
- Empty early passes ("", or whisper noise like a lone ".") render as a
  subtle "Listening…" placeholder, not as flashing punctuation.

## 4. Local-agreement stabilizer (FR-L4, pure TS)

`src/lib/liveText.ts`:

```ts
stabilize(prev: LiveText, nextRaw: string): LiveText
// LiveText = { stable: string; tentative: string }
```

- Word-level longest-common-prefix between consecutive passes: words agreeing
  with the previous pass's full text (stable + tentative) join `stable`;
  the disagreeing tail becomes `tentative`.
- `stable` never shrinks and never rewrites — once a word is stable it stays
  (that's the whole point: no text wobble).
- Case/punctuation changes on the LAST stable word are tolerated (engines
  refine trailing punctuation): compare words case- and punctuation-
  insensitively for agreement, but display the newest rendering of tentative
  words and the first-seen rendering of stable words.
- Reset on each new recording.

## 5. Tests

- **U6** (Vitest, `liveText.test.ts`): growth ("hello" → "hello world");
  disagreement tail ("hello ward" → "hello world" keeps "hello" stable,
  replaces tentative); stable never shrinks even if a later pass returns
  less text; punctuation-tolerant agreement ("hello." vs "hello"); empty
  and noise-only passes; reset.
- **E10a**: overlay with `show-overlay {state:"recording", live:true}` +
  synthetic `stream-text` events renders the text region above the waveform,
  with stable and tentative parts distinguishable (distinct test ids), and
  the waveform still animating.
- **E10b**: `live:false` renders today's compact pill — no text region in
  the DOM.
- **E10c**: settings General shows the toggle, default on, persists via
  set_settings (mock).
- **R10** (Rust): the live-loop interval controller as a pure function —
  stretch on slow passes, cap, recovery. The audio snapshot must have a unit
  test proving capture continues (snapshot twice, second is longer).
- Existing suites (R1–R9-, U1–U5, E1–E9, I1–I2) keep passing; the mock
  gains `stream-text` passthrough only.

## 6. Definition of Done

1. `npm run validate` exits 0 with complete output — all existing suites
   plus U6, E10a–c, R10 — ending `VALIDATION: ALL PASSED`, printed in the
   transcript.
2. `npm run tauri build` exits 0; .app path + size (< 80 MB) printed.
3. `grep -rn ".skip\|.only\|.todo" tests/` prints nothing.
4. README: a short "Live transcription" paragraph (what it shows, that the
   pasted text is the cleaned final pass, the toggle's location).
5. ARCHITECTURE.md: live-loop note — cadence, perf guard, measured live-pass
   duration for whisper-tiny on this machine, and why stop stays
   authoritative.
6. Anything infeasible → BLOCKERS.md; never game a check.

Manual checks after green: dictate a long paragraph with live mode on —
words appear as spoken, no wobble in already-shown text, stop pastes the
cleaned version; toggle off → old compact behavior; slow-machine simulation
not required (the guard is unit-tested).
