# Meadows: handoff for coding agents

A real-time Valheim-inspired world in the browser: meadows, Black Forest, rivers, ponds, sea, painted skies.
Vite + TypeScript + vanilla Three.js 0.187 (WebGL2, custom GLSL, no engine). ~9k lines in `src/`.

Read these too: `CLAUDE.md` (the working rules this project has used so far), `docs/ROADMAP.md` (open work, ideas,
and a long "Done" log that explains *why* things are the way they are, with measurements), `docs/CHARACTER.md`
(how the player model is built).

## What the owner wants

The bar is "amazing": rich, lush and beautiful first, Valheim's look, realism wherever it helps. Feedback so far:

- **Loves**: light beams through the forest, rich saturated color (sky running blue → violet-pink → orange like
  Valheim), the ponds/lilies/frogs, dense meadows with flowers.
- **Dislikes**: anything washed out or milky (bright haze, a sky that tone-maps to white, being blinded when
  looking at the sun); fake or simple geometry (flat river banks were called out); flicker or shimmer when moving
  (very sensitive to this: grass, shadows, exposure pumping); not seeing anything at night or in deep forest.
- Prefers readable over physically correct: "see in the dark" is deliberately artificial.
- Every effect should have a panel control, and zero should mean off (haze 0 = clear air).

## Run and look

```bash
npm install
npm run assets          # CC0 ground textures and rocks into public/assets/ (gitignored); optional, falls back
npx vite                # http://localhost:5173
npx tsc --noEmit -p .   # type check (there are no unit tests)
```

URL params: `?cam=x,heightAboveGround,z,tx,ty,tz&time=hours&view=first&defaults`. `defaults` ignores the
panel settings saved in localStorage (use it for every scripted shot). `H` toggles the panel, `T` the torch,
`V` first/third person (third is the default), `F` fly, Shift runs.

`window.__app` exposes the camera, `player` (move/rotate it, then `snapView()`), `lookAt(obj, x, y, z)`,
`settings`, `updateSun()`, `post` (every pass's uniforms: `post.atmosphere`, `post.grade`, `post.taa`,
`post.luminance`), `sky`, `wind`, `world` (`world.fns.height/forest/river/pondEdge/ponds`), `display/applyDisplay`.
Note `player.lookAt` points the wrong way; use `__app.lookAt(__app.player, ...)`.

**Visual work is done when a screenshot shows it**, not when it type-checks. Shoot at 1280×720, compare against
before/after and the reference shots, and measure fps (meadow ~40, forest ~33 headless; the target is 60).

## Measurement scripts (`scripts/measure/`)

Playwright snippets (run with Playwright MCP's `browser_run_code` using `filename`, or adapt to a Playwright test).
They write PNGs under `.playwright-mcp/measure/` (gitignored). All use deterministic placement; wind gusts make
single runs noisy, so repeat 2-3×.

- `ghost.js`: TAA quality in motion. Renders identical frame sequences (same positions and wind time per frame)
  with TAA off as the reference and each TAA config, then reports `ghost` (blurred abs error vs reference),
  `flick` (temporal 2nd derivative of that error) and `sharp`. This is the trustworthy motion metric.
- `walk.js`: older, simpler flicker metric on a grass crop (second temporal derivative of luma). Good for still
  views; while moving it mostly measures legitimate motion.
- `heat.js`: per-pixel flicker heat map while moving slowly; shows *where* things flicker.
- `pump.js`: exposure stability while turning (min/max exposure and the largest per-frame change).
- `meter.js`: shots at fixed views/times with the metered luminance and exposure printed.

Image stats: `ffmpeg -i x.png -vf signalstats,metadata=print:file=- -f null -` gives YAVG (brightness, 16 = black)
and SATAVG (saturation).

## Architecture

**Frame** (`src/main.ts` animation loop → `src/post.ts` composer):
RenderPass (MSAA ×4, half-float) → `WaterPass` (`water.ts`: sea mesh + pond discs, refraction from a scene copy)
→ `AOPass` (`ao.ts`) → `VolumetricPass` (`volumetric.ts`, half-res shadow-map march: R = air sun visibility,
G = depth key, B = the surface's own sun visibility) → `CloudPass` (`clouds.ts`, raymarched cumulus) →
**Atmosphere** (`post.ts` `AtmosphereShader`: AO, cloud shadows, teal shade, exponential + forest haze, ground fog,
water mist, beams, torch glow, light shafts, flares, sky cap; output capped at 6.6) → `TAAPass` (`taa.ts`) →
`LuminancePass` (`exposure.ts`, async 32×18 meter) → overlay (motes) → bloom (threshold 6) → whimsy glow →
OutputPass (Neutral tone mapping + exposure) → Grade (`GradeShader`: split tone, S-curve, shadow lift, vignette).

**World** (`src/world.ts` builds everything from `createWorld(params)` in `worldgen.ts`): height/forest/dirt/river
fields, rivers with rocky banks (`riverEdge`), ponds (`ponds`, `pondEdge`; each pond is a carved basin with its own
water level). Terrain mesh + splat colors (`terrain.ts`), far land (`far.ts`), trees (ez-tree + impostors,
`trees.ts`, `impostor.ts`), streamed grass (`grass.ts`) and ground cover layers (`cover.ts`: ferns, flowers, tall
meadow, reeds, shrubs, moss, litter, logs), rocks (scanned CC0 + fractured procedural, `rocks.ts`), life
(`life.ts` butterflies/birds/leaves, `deer.ts` rigged herds, `pond-life.ts` lilies/frogs/fish).

**Lighting**: one directional light is sun by day and moon by night; `cascades.ts` adds a far shadow cascade by
replacing three's shadow chunks. Ambient comes from a PMREM of the sky's lighting probe. `updateSun()` in main.ts
sets colors and intensities by sun elevation; the sky palette is a table of color stops by elevation in `sky.ts`.
Exposure = settings × night boost × eye adaptation (into-sun dip, forest open-up by day, metered dark lift at night).

**Settings** (`persist.ts`): only values the user changed are stored, so changing a default reaches everyone who
hasn't touched that slider. Panel is lil-gui (folders: time/atmosphere, Effects, Display, Controls, world).

## Invariants and gotchas

- The scene target's **alpha carries wind motion** to the TAA (`addWind` in `wind.ts`, `MOTION_SCALE`). Opaque
  materials must write alpha 1; new swaying materials go through `addWind`. Alpha-to-coverage is swapped for alpha
  test while TAA is on (`useCoverage` in main.ts).
- Sky renders at depth exactly 1.0; test sky with `depth >= 1.0`, never an epsilon.
- Tone mapping is **Neutral**, not ACES (ACES pulls saturated blues/greens to white). The visible sky's brightest
  channel is soft-capped at 1.6 (`uSkyKnee`/`uSkyCeil`, in both `sky.ts` and the atmosphere pass) so it never
  tone-maps to white; the sun disc is exempt for bloom.
- The haze pass caps HDR at 6.6 before bloom (threshold 6). Raising either veils the frame near the sun.
- Beams and light shafts scale with the haze slider (`uFogDensity / 0.00045`). Keep it that way.
- `THREE.MathUtils.smoothstep(x, min, max)` takes the value first; `worldgen.ts`'s `smoothstep(a, b, x)` last.
- Worldgen uses seeded `mulberry32` sequences; adding a `rand()` call in a placement loop reshuffles that whole
  layer (trees, rocks), so A/B screenshots across such a change show different layouts.
- TAA: the variance box is 1.5σ standing still (less grass shimmer) and 1.0σ once a pixel moves 3+ px/frame (less
  ghosting while running). Measure both cases with `ghost.js` and `walk.js` before retuning.
- Things that move on their own (character, deer, frogs, fish, birds, butterflies) get motion vectors from
  `MotionPass` (`motion.ts`); add new animated groups to `movers` in main.ts.
- A shader that fails to compile just draws nothing: check the console for `Shader Error` after GLSL edits, and
  don't name locals with GLSL ES 3 keywords (`flat`, `smooth`, `sample`).
- Overlay materials (motes, rain) depth-test against `post.sceneDepth`, a copy taken before the full-screen passes.
- `VolumetricPass` skips its march until the shadow map exists (a `sampler2DShadow` can't be bound before).
- Rock moss near ponds reads a `uPonds[16]` uniform array (`scanned-rocks.ts`); more than 16 ponds needs a bigger array.
- Hot reload can abort Playwright navigation (`ERR_ABORTED`); navigate again.

## Rules for changes

- Commit in small, described steps; record finished work in `docs/ROADMAP.md` "Done" with what was measured.
- **Secrets**: never commit `.env*`, keys, credentials; read the full staged diff before every commit/push.
- `reference/` holds the owner's Valheim screenshots: copyrighted, gitignored, for comparison only. Never commit
  or redistribute them, and don't recreate Valheim's assets; the look is the goal, not a copy.
- Third-party assets must be redistributable (CC0 first: Poly Haven, ambientCG), fetched by `scripts/fetch-assets.mjs`.

## Where to push next (ranked)

1. **Motion clarity.** Running (10 m/s) still shimmers more than standing. Ideas: a reactive mask for alpha-tested
   foliage, temporal accumulation for the half-res AO/volumetric buffers themselves (they currently lean on the main
   TAA), a sharpening pass that doesn't re-amplify jitter.
2. **Performance**: 33-43 fps at 1280×720 headless; 60 is the goal. Profile the vertex-heavy cover layers and
   trees first, then the atmosphere pass (it does a lot per pixel).
3. **Sunset glow over the sea** still reads pastel; the bright haze over land toward a low sun is the suspect.
4. **Valheim look**: compare against `reference/` at matching times of day; clouds' shapes, sun bloom, shade color.
5. Pond follow-ups (ripple rings where frogs dive or fish rise, dragonflies), landmarks (rune stones, a
   longhouse), rain splashes on the ground, wet rocks and trunks. More in the roadmap's "Ideas" list.
