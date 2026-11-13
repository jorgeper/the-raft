# SPEC: Tiny Baseball v1 — cozy retro 3D arcade baseball in the browser

A tiny, cute, two-player arcade baseball game rendered with three.js. Low-poly
retro look, big-headed chibi players, packed cheering crowd, warm blue sky.
Simple mechanics: pitch, swing on timing, everything else is automatic. §9 is
the goal condition.

Stack: Vite + TypeScript + three.js. Tests: Vitest (unit) + Playwright (e2e).
No remote assets of any kind — all geometry procedural, all audio synthesized
with WebAudio, fonts system/CSS only.

---

## 1. Architecture (FR-A)

1. Game rules live in a pure TypeScript engine (`src/engine/`) with **zero
   three.js imports** (U-tests import it in Node without a DOM). Rendering
   (`src/render/`) only reads engine state and forwards input events.
2. All randomness flows through one seeded PRNG injected into the engine. Same
   seed + same input sequence ⇒ identical final state (U4 asserts).
3. The app exposes `window.__game` in all builds: `{ state, dispatch(action),
   ffwd(seed) }` where `ffwd` simulates a full game headlessly. E-tests drive
   the game through it.

## 2. Game rules (FR-G) — arcade, not baseball

1. Two teams, **3 innings**, 3 outs per half-inning, standard top/bottom order;
   home team bats last and the bottom of the 3rd is skipped if the home team
   already leads (U2).
2. No balls, no walks, no steals: every pitch is hittable. A swing-and-miss or
   a taken pitch is a **strike**; 3 strikes = out. A foul is a strike but never
   the third (U5).
3. Swing outcome is a pure function of timing offset (ms between swing and the
   ball crossing the plate) and pitch type, resolved with the seeded PRNG:
   - |offset| ≤ 40 → power contact: home run 30%, triple 10%, double 30%,
     single 30%.
   - 40 < |offset| ≤ 90 → contact: single 45%, double 15%, fly out 25%,
     ground out 15%.
   - 90 < |offset| ≤ 140 → foul.
   - |offset| > 140 or no swing → strike.
   U1 asserts each band and the exact distribution under a fixed seed.
4. Baserunners advance automatically by the hit value (single = 1 base, etc.);
   runs score when a runner crosses home. Game over ⇒ winner declared; a tie
   after 3 innings plays extra innings until one half-inning pair breaks it
   (U3).
5. Pitch types: fastball (fast, straight), curve (slower, ball curves
   laterally in flight), changeup (slow with a late speed drop). Type affects
   ball flight time ±30% and is chosen by the pitching side.

## 3. Controls & multiplayer (FR-M)

1. Title screen offers **1P vs CPU** and **2P shared keyboard**; selectable by
   keyboard and click (E2).
2. Batting side: `Space` swings. Pitching side: `1/2/3` selects pitch type,
   `←/→` nudges aim (3 lanes), `Enter` throws. In 1P mode the CPU pitches and
   bats its half with randomized (seeded) competence.
3. Sides swap automatically every half-inning; a banner tells each player what
   they're doing now ("P2 — YOU'RE PITCHING").
4. Out of scope for v1: online/networked play, gamepads, touch controls,
   fielding or running controls, ball/strike umpiring, player rosters or
   stats.

## 4. Retro look (FR-R)

1. The scene renders to a low-res target (default 1/3 of CSS pixel size,
   ceiling 640 px wide) upscaled with nearest-neighbor filtering — visible
   chunky pixels, no post-processing blur.
2. Flat-shaded low-poly geometry only; one warm sunlight + soft ambient;
   colors drawn from a defined palette of ≤ 24 colors listed in a
   `src/render/palette.ts` constant (U6 asserts the palette module exports
   ≤ 24 unique hex values and every material color used is from it).
3. Players are chibi-proportioned (head ≥ 40% of total height), built from
   boxes/capsules; batter, pitcher, catcher and 4 fielders visible; idle
   bobbing animation.
4. World: green diamond with dirt infield, white foul lines and 3 bases +
   home plate, outfield wall, two grandstands, cartoon sun, gradient blue sky
   with ≥ 5 drifting blocky clouds.

## 5. Crowd (FR-C)

1. ≥ 150 crowd members in the stands (instanced meshes; palette-varied), with
   a constant gentle idle sway.
2. On any hit: crowd does a short jump/wave and a synthesized cheer plays. On
   a home run: bigger cheer, crowd wave travels through the stands, confetti
   particle burst (≥ 100 particles).
3. Ambient synthesized crowd murmur loops during play; `M` toggles all audio,
   state persisted to `localStorage` (E5 asserts toggle + persistence via
   `window.__game.state.muted`).

## 6. HUD & flow (FR-H)

1. Retro scoreboard HUD (CSS, monospace/pixel styling): inning + half, both
   scores, outs, strikes — always visible in play (E3 asserts values track
   engine state).
2. Event banners on: HOME RUN, hit type, OUT, SIDE RETIRED, and final
   "GAME OVER — <side> WINS" screen with a rematch button that fully resets
   state (E4).
3. Playable at 60 fps target; the render loop must not allocate per-frame
   (no `new` of vectors/materials inside the tick — code-review level, not
   tested).

## 7. Tests (FR-T)

1. Unit U1–U6 as referenced above, engine-only, no DOM.
2. Playwright e2e: **E1** app boots, canvas visible, zero console errors;
   **E2** both modes reachable from title; **E3** scripted pitch+swing via
   `__game.dispatch` updates HUD; **E4** `__game.ffwd(seed)` reaches game
   over, winner shown, rematch resets to title-ready state; **E5** mute
   toggle + persistence across reload.
3. `npm run validate` runs typecheck, unit, build, e2e against the production
   preview, and ends with the single line `VALIDATION: ALL PASSED` only if
   everything passed.

## 8. Non-functional

1. `npm run build` output ≤ 2 MB total; no network requests at runtime after
   initial page load (E1 asserts no non-localhost requests).
2. Works in current Chromium (Playwright's) at 1280×720 and 1920×1080.

## 9. Goal condition

See GOAL.md. SPEC.md must not be modified; tests may not be weakened,
skipped, or deleted.
