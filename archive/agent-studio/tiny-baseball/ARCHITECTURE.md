# Tiny Baseball — architecture

## The engine/render split

```
src/engine/   pure TypeScript, ZERO three.js imports (U-tests run it in Node)
  prng.ts       mulberry32 — the single seeded PRNG (SPEC §1.2)
  resolve.ts    resolveSwing(offsetMs, pitchType, rng) → outcome; timing bands
                and per-band probability tables (SPEC §2.3)
  game.ts       createGame(seed) → { state, dispatch(action) } state machine:
                innings/outs/strikes/bases/scores, walk-off, skip-bottom-3rd,
                extra innings; plus simulateGame/ffwd for headless full games

src/render/   three.js only; reads engine state, never mutates it
  palette.ts    the ≤24-color retro palette — U6 fails the build if any other
                hex literal appears in src/render/*.ts
  scene.ts      sky gradient, sun, drifting clouds, field, wall, grandstands
  players.ts    chibi player factory (head ≈ 42% of height) + cast placement
  crowd.ts      instanced crowd (≥150), idle sway / jump / traveling wave,
                confetti burst
  ball.ts       pitch flight (per-pitch personality) and hit trajectories

src/hud.ts    DOM scoreboard, banners, title/game-over screens (pure view)
src/audio.ts  WebAudio-synthesized crack/pop/cheers/crowd murmur — no files
src/main.ts   the controller: input, CPU opponent, timing (when the ball
              crosses the plate), FX triggering, render loop
```

The engine is a synchronous reducer: `dispatch({type:'pitch'|'swing'|'cross'|
...})` returns the next state. Real-time only exists in `main.ts`, which
measures the swing keypress against the ball's plate-crossing time and passes
the offset in milliseconds to the engine. That's why the whole game logic is
unit-testable and deterministic per seed.

All gameplay actions — keyboard, CPU, and tests alike — flow through one
`act()` funnel in `main.ts`, which is what triggers banners, sounds, crowd
reactions, and ball animations off engine state transitions.

## The `window.__game` test hook (SPEC §1.3)

Exposed in every build:

- `__game.state` — live engine state (read-only getter).
- `__game.dispatch(action)` — routes through `act()`, so HUD/FX stay in sync;
  includes the test-only `{type:'forceOutcome', outcome}` action to bypass
  the RNG.
- `__game.ffwd(seed)` — replaces the live game with a fully simulated,
  finished game (deterministic per seed) and returns its final state; the
  game-over screen and rematch flow work from there.

Playwright (E1–E5) drives the app exclusively through this hook plus real
keyboard/click events, so e2e never depends on animation timing.

## Validation

`npm run validate` = `tsc --noEmit` → `vitest run` (U1–U6) → `vite build` →
`playwright test` (E1–E5, against the production preview on :4173) → dist
size gate (≤ 2 MB) → prints `VALIDATION: ALL PASSED`.
