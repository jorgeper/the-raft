# Downhill Madness — Game Spec

## 1. Pitch

A hiker crests a hill on a Pacific Northwest trail, trips, and starts sprinting downhill — and physically cannot stop. The player steers left/right and jumps to survive an ever-faster, ever-denser gauntlet of roots, rocks, sheep, cows, hikers, falling trees, and worse. One solid hit ends the run in a spectacular physics-based ragdoll crash. Score = distance covered + style points for air time, tricks, and near-misses. The game is deliberately hard: a good human player survives at most ~60 seconds.

**Tone: cozy and hilarious.** Blue skies, puffy clouds, lush organic greenery, warm sunshine — a gorgeous day ruined by one man's inability to stop running. The character is floppy and funny in motion (semi-ragdoll even while running), the animals are adorable, and every crash is a physics spectacle you laugh at rather than wince at. Nothing in the game should feel grim, gritty, or stormy.

Rendered in Three.js with a rich stylized-procedural look — no external art assets. Everything (terrain, trees, animals, character) is generated in code.

## 2. Tech stack

- **Three.js** (latest stable, installed from npm) for all rendering.
- **Vite + vanilla JavaScript** (ES modules). No framework, no TypeScript.
- **Vitest** for unit tests of pure logic.
- Optional: the `postprocessing` npm package for bloom/vignette. No other runtime dependencies.
- No external assets: no downloaded models, textures, sounds, or fonts. All geometry procedural, all textures via vertex colors / canvas-generated / shader, all audio synthesized with WebAudio.
- Targets: 60 fps on a mid-range desktop, 30+ fps on a mid-range phone. `devicePixelRatio` capped at 2.
- Commands: `npm run dev` (play locally), `npm run build` (static bundle), `npm test` (unit tests).

## 3. Controls

Desktop:
- **A / ←**: steer left. **D / →**: steer right (continuous while held).
- **Space / W / ↑**: jump.
- **S / ↓ / T**: trick (spin) — only meaningful while airborne.
- **R / Enter**: restart from the end screen. **M**: mute.

Mobile (touch):
- **Hold left / right half of screen**: steer that direction.
- **Swipe up** (anywhere): jump.
- **Tap with a second finger while airborne** (or swipe down): trick.
- **Tap**: restart from the end screen.

Movement is **continuous steering** — no lanes. The player can be anywhere across the trail width.

## 4. Core mechanics

All values below are starting points; tune during the difficulty pass (§11) but keep the same shape.

### 4.1 Speed (the "can't stop" rule)

- Forward speed starts at **7 m/s** and increases by **+0.28 m/s per second**, capped at **30 m/s**.
- Speed never drops below the current ramp value except during a stumble (below). There is no brake input.
- Distance traveled (meters) is the primary score component and is displayed live.

### 4.2 Steering

- Lateral speed scales with forward speed: `lateral = 0.45 × forwardSpeed`, clamped to [4, 11] m/s, with a short ease-in (~120 ms) so it feels weighty, not twitchy.
- Playable trail width: **8 m** (±4 m from center). Steering past the edge is blocked by the trail's log/rock/fern borders; grinding against the edge causes a stumble after 0.4 s of continuous contact.
- The character leans visibly into steering.

### 4.3 Jumping

- Jump is a fixed impulse: initial vertical velocity **8.5 m/s**, gravity **25 m/s²** → ~0.68 s air time, ~1.45 m apex.
- No double jump. Jump input is buffered 100 ms before landing (feels responsive).
- **Ramp launches**: sloped rocks/logs marked as ramps multiply the jump impulse ×1.6 if the player jumps on them (or auto-launch at ×1.3 if run over) → big air, big style.
- Steering authority in air is reduced to 40%.

### 4.4 Collisions: solid vs. soft

Every obstacle is tagged **solid** or **soft**:

- **Solid hit → crash.** Run ends in a **spectacular physics-based ragdoll** (see §7.1): the character goes fully limp, launches with his run momentum, tumbles, bounces off terrain and obstacles, and flops to rest — different and funny every time. Camera goes slow-motion at 0.3× for ~1.5 s, then the end screen slides in.
- **Soft hit → stumble.** Forward speed drops 30% (never below 6 m/s), camera lurches, character flails for 0.8 s. During those 0.8 s the player has full control but a second **soft** hit escalates to a crash. Stumbling is severely punishing late-game because the speed ramp doesn't wait.

Collision detection: AABB (player capsule approximated as a box, ~0.6 × 1.7 × 0.6 m) vs. per-obstacle AABBs, checked in the fixed-timestep update. Airborne players pass over any obstacle whose height is below the player's current foot height.

### 4.5 Tricks & style

Style events award points with floating HUD popups (`+250 SPIN!`):

| Event | Points | Rule |
|---|---|---|
| Near-miss | +50 | Pass within 0.5 m of a **solid** obstacle without touching |
| Threading | +100 | Pass between two obstacles whose gap is < 2.5 m |
| Air time | +30/s | Accrued while airborne, ×2 off ramps |
| Spin | +250 per 360° | Trick input starts a spin (0.6 s per rotation). **Landing mid-rotation = crash.** Consecutive spins in one jump stack: 250, 500, 750… |
| Scatter | +25 | Make sheep/chickens flee by passing close |
| Combo multiplier | ×1.5 | Any 3 style events within 3 s multiplies that window's style points |

Score = `floor(distance in meters) + style points`. Best score/distance persist in `localStorage`.

## 5. World generation

- The world is a **chunk-recycled ribbon**: chunks of **50 m** length, ~10 alive at once (≈250 m visible before fog swallows the rest). Chunks ahead are generated from a **seedable RNG**; chunks behind are released to pools.
- The trail **winds and descends**: the trail centerline is a gentle spline (lateral sine-ish wander up to ±10 m per 100 m, curvature capped so the player is never blindsided) and drops at 8–14% grade, steepening with phase. Everything (obstacles, decor) is placed relative to the centerline.
- Camera-relative rendering: the player stays near the world origin; the world shifts past (avoids float precision issues on long runs).
- Each chunk contains: the trail ribbon mesh, off-trail terrain (noise heightfield), instanced vegetation, decor, and obstacle spawns from the difficulty table (§6.3).

### 5.1 Biome phases by distance

| Phase | Distance | Look | New threats |
|---|---|---|---|
| 1. Trailhead | 0–150 m | Sunny open meadow-edge, ferns, wildflowers, butterflies, big blue sky | roots, rocks, mud, branches |
| 2. Deep forest | 150–400 m | Lush fir canopy, dappled sunlight, god rays, floating pollen | sheep, cows, hikers, dog leashes, logs, streams |
| 3. Steep section | 400–700 m | Rocky slopes bursting with wildflowers, cliff-edge views over a sunlit valley | falling trees, mountain bikers, rockslides, deer, ramps everywhere |
| 4. Golden chaos | 700 m+ | Warm golden-hour light, long shadows, drifting leaves — still cozy, just absurdly busy | rolling logs, bee swarms, ranger roadblocks, tree slaloms, double spawns |

The sky stays blue and the mood stays cozy in every phase — escalation comes from density and speed, never from gloom. Phases blend over ~30 m (light color, vegetation mix, density lerp).

## 6. Obstacles

### 6.1 Catalog

Each obstacle: name, tag (**solid**/**soft**), behavior, how to avoid. All models procedural, charming, readable at speed.

**Phase 1**
1. **Root snarl** (soft) — dark twisted roots across part of the trail. Jump or steer.
2. **Small rock** (soft) — knee-high mossy stone. Jump or steer.
3. **Boulder** (solid) — chest-high basalt block, moss cap. Steer (too high to jump).
4. **Mud puddle** (soft, special) — no stumble, but 20% speed drag while inside + mud particle splatter. Jump or steer.
5. **Fallen branch** (soft) — shin-high, spans 30–60% of width. Jump.

**Phase 2**
6. **Sheep** (soft) — wanders slowly across the trail; bleats and bolts if you near-miss it (style points). Hitting one sends it tumbling (comically, it recovers) and you stumble.
7. **Cow** (solid) — big, stands broadside across up to half the trail, tail flicking. Steer.
8. **Hiker** (solid) — walks uphill toward the player, sometimes in pairs with poles. Steer.
9. **Dog + leash tripwire** (leash: soft, dog & owner: solid) — an owner on one side, dog on the other, taut leash between at shin height spanning up to 4 m. **Jump the leash.**
10. **Log** (solid, ramp variant exists) — waist-high fallen trunk spanning 40–70% of width. Jump it or steer around its ends; the ramp-sloped variant grants a boosted launch (§4.3).
11. **Stream band** (soft, special) — a 2.5 m wide creek across the whole trail with stepping stones. Jump it, or hit water: heavy stumble + splash.

**Phase 3**
12. **Falling tree** (solid) — a fir beside the trail creaks (audio + shudder telegraph ~1.2 s), then topples across the trail. If it's down before you arrive: jump the trunk. If it falls *on* you: crash. Timing puzzle.
13. **Mountain biker** (solid) — bombs downhill from behind (bell rings as telegraph) or ahead; travels a predictable line. Steer out of the line.
14. **Rockslide** (solid) — 3–5 rocks bounce across the trail from the uphill side, staggered. Thread the gaps.
15. **Deer** (solid) — bounds across the full trail in two leaps; the gap under its arc is jumpable at the right moment.
16. **Picnic party** (solid) — blanket, basket, seated family, wide cluster on one side. Steer.
17. **Cliff-edge narrows** (special) — trail narrows to 3.5 m for 20–30 m with a fence on the drop side; fence gaps (solid posts) demand precision.
18. **Log ramp** (opportunity) — angled trunk; hit it with a jump for ×1.6 launch and huge style.

**Phase 4**
19. **Runaway rolling log** (solid) — rolls down the trail toward the player spanning the full width. **Must jump.**
20. **Bee swarm** (soft, special) — drifting cloud; passing through stumbles you and smears/vignettes the screen for 1.5 s.
21. **Ranger roadblock** (solid) — sawhorse barriers + a ranger waving a STOP sign, spanning all but one 2 m gap.
22. **Tree slalom** (solid) — 40 m of alternating trunks in the trail, forcing rhythm steering.
23. **Chicken flock** (soft) — a dozen chickens; they scatter (style points) but clipping several stumbles you.
24. **Waterfall spray** (special) — mist wall that whites out vision for ~1 s; obstacles may hide behind it.

### 6.2 Fairness rules (the spawner MUST enforce)

- **Always solvable**: for every generated chunk, verify at least one survivable path exists given current max speed — minimum lateral gap ≥ the distance steerable in the available reaction time, and jumpable obstacles spaced ≥ one full jump cycle apart. If verification fails, regenerate the pattern.
- Minimum telegraph: moving/timed obstacles (falling tree, biker, deer, rockslide, rolling log) always signal ≥ 1 s before occupying the player's line at current closing speed.
- No solid obstacle spawns within 15 m after a forced landing point.

### 6.3 Difficulty scaling

- Spawn density: from ~1 obstacle per 25 m (phase 1) to ~1 per 7 m (phase 4), interpolated by distance.
- Weighted spawn tables per phase (data-driven: a plain JS table of `{obstacle, weight, minDistance}` — unit-testable).
- Past 900 m, density and speed are capped but **pattern complexity** keeps rising: paired spawns (leash + boulder, biker + rockslide) drawn from a combo table.
- Target: a median skilled player dies between 350–800 m (~30–60 s). Casual players die < 250 m.

## 7. Art direction (the headline feature — invest here)

Style: **cozy stylized low-poly PNW** — think Alto's Adventure warmth meets A Short Hike charm. Not photoreal; lush, sun-drenched, rounded, inviting. A place you'd want to picnic — which is what makes barreling through it at 30 m/s funny.

- **Palette**: vivid organic greens (spring fir #4a7c3f, meadow grass, moss #7a9a4c), saturated **blue sky** (#6fb7e8 zenith fading to warm horizon) with slow puffy cumulus clouds, honey-warm sunlight, wildflower accents (lupine purple, poppy orange, daisy white), soft brown dirt trail.
- **Lighting**: one warm directional sun (high and cheerful, easing toward golden-hour in phase 4) + sky-blue hemisphere fill. Shadow map (2048) follows the player. ACES filmic tone mapping, physically-correct lights.
- **Atmosphere**: light distance haze (never gloom); **god rays** as animated additive billboard shafts through the canopy in phase 2; floating pollen motes and butterflies in phase 1; drifting golden leaves in phase 4. No rain, no storm.
- **Vegetation** (all `InstancedMesh`): everything **organic and rounded** — no hard cones or straight rows. 3 Douglas-fir variants with irregular, slightly asymmetric blobby foliage layers and vertex-color gradients, red cedars, big-leaf ferns (hundreds), wildflower clumps, tufty grass, moss-capped rocks, stumps, nurse logs, salal underbrush. Per-instance random scale/rotation/tilt and a gentle wind-sway vertex shader (each plant wobbles slightly out of phase) so the forest feels alive. Off-trail density high; readable clearing on the trail.
- **Terrain**: ribbon + noise heightfield with soft rolling curves, vertex-colored (no image textures): warm dirt trail center, grassy rooty edges, flower-dotted verges. Distant parallax: 2–3 sunlit ridge layers + the blue-sky dome with clouds; phase 4 tints it all golden.
- **Animals**: adorable articulated-low-poly — boxy wool sheep with round faces, holstein-patch cows (canvas texture) that chew as you pass, bounding deer with a two-beat leap, chickens as flapping wedges. Cute > realistic, always.
- **Camera**: high chase cam 6.5 m behind / 3.5 m up, pitched down the slope toward a point ~14 m ahead so oncoming obstacles are clearly readable at speed (≥2 s of visible trail at max speed). FOV 60° → 75° with speed, subtle speed shake, slow-mo pull-out on crash.
- **Post**: subtle bloom (sunlight/sky pop) + gentle vignette. Skip if the `postprocessing` package fights the fps budget on mobile — haze + tone mapping carry the look.

### 7.1 Character: floppy in life, spectacular in death

The character's comedy is a core feature — invest as much here as in the environment.

- **Build**: articulated low-poly dude — head with messy hair (no hat), torso, backpack, upper/lower arms and legs. Every body segment is an independent flat piece pivoted at its joint, driven by physics each frame.
- **Running = live physics puppet.** The runner is a Verlet particle skeleton (same solver family as the crash ragdoll) simulated every frame: motor impulses puppet the hips, torso and legs through a sprint cycle whose stride scales with speed, while the **arms are near-free physics bodies** — a windmilling tangential force (direction flips every few seconds), speed-scaled turbulence, and sprint drag keep them flailing out of control. Steering, jumps and landings inject inertial pseudo-forces so the arms and head whip around from real momentum. He must **never look calm**: goofy windmilling jog at low speed, utterly unhinged flailing sprint at max. Stumbles slacken the motors (near-collapse chaos); jumps tuck then panic-pedal; spins whirl the whole flailing body.
- **Crash = the strings get cut.** On a solid hit, the same particle skeleton converts to a full free ragdoll in world space: limbs stay jointed, the body launches with current momentum, tumbles down the slope, bounces off terrain and nearby obstacles, sends the backpack flying, scatters any nearby sheep/chickens, and flops to rest in a ridiculous pose. Crashes must be **emergent and different every time** — speed, angle, and what he hits all change the outcome. Slow-mo (0.3×) with the camera orbiting slightly makes each wipeout a highlight-reel moment. Add small comedic touches: a puff of dust, spiraling stars over the resting body.
- The crash is never gory or grim — pure slapstick. He pops up rubbing his head on the end screen.

## 8. Audio (all WebAudio-synthesized)

- Footstep ticks synced to stride frequency (tempo = speed), with the occasional comedic scuff/squeak.
- Cheerful ambience: synthesized birdsong chirps, soft wind through leaves swelling with speed, bees buzzing near flowers.
- Event sounds lean slapstick: cartoon boing on jumps, landing thud, near-miss whip, sheep bleat, cow moo, bike bell, creak-CRACK for falling trees, a comedic yelp + tumbling thumps on crash, then happy birds chirping over the end screen.
- Mute toggle persisted in `localStorage`. No music required (wind + footsteps are the soundtrack); a simple synth drone is optional.

## 9. UI / screens

- **Start screen**: title "DOWNHILL MADNESS", the scene idling behind (camera drifting over the trailhead), controls hint, personal best, "press any key / tap to run". The dude then trips over the trailhead sign and the run begins (~1 s canned intro).
- **HUD**: big distance counter (m) top-center; small speed readout; style popups near the character; combo indicator. HUD scales for portrait phones.
- **End screen**: after the crash slow-mo — "WIPEOUT!", distance, itemized style lines (spins ×2 = 500, near-misses ×7 = 350…), total score, best (with "NEW BEST!" state), retry prompt. Restart is instant (pools reset, no reload).
- Pause on `Esc` / visibility loss.

## 10. Architecture

```
downhill-madness/
  index.html
  src/
    main.js            // bootstrap, screen state machine (start → run → crash → end)
    engine/            // renderer setup, fixed-timestep loop (60 Hz update, rAF render, interpolation)
    world/             // chunk manager, trail spline, terrain builder, vegetation instancing, sky/fog/phase blending
    player/            // controller (steer/jump/trick/stumble state machine), procedural animation, ragdoll
    obstacles/         // registry (one module per obstacle: build + behavior + AABBs), spawner + fairness verifier, object pools
    scoring/           // distance, style-event detection, combo logic, persistence
    input/             // keyboard + touch, normalized to {steer: -1..1, jump, trick}
    ui/                // HUD, screens, style popups
    audio/             // WebAudio synth engine + event sounds
    utils/             // seedable RNG, math helpers, AABB
  tests/               // vitest
```

- Fixed-timestep simulation (60 Hz) decoupled from render; all gameplay deterministic given a seed (RNG is injected, never `Math.random` in gameplay code).
- Object pooling for all obstacles and particles; zero per-frame allocations in the hot loop.
- Each obstacle module exports `{create(pool), spawn(chunk, rng, difficulty), update(dt), aabbs()}` — adding an obstacle touches one file plus the spawn table.

## 11. Testing & acceptance

**Unit tests (Vitest)** — pure logic only, no WebGL:
- Speed ramp curve (values at t = 0/30/60 s, cap respected).
- Spawn tables: weights valid, phase gating respected, density monotonically increasing.
- Fairness verifier: hand-built impossible patterns rejected, possible ones accepted.
- Scoring: near-miss/threading/air/spin/combo math; localStorage best round-trips (mocked).
- AABB collision helpers, incl. airborne pass-over.
- Seeded RNG: same seed → identical chunk layout.

**Acceptance checklist (manual, must all pass)**:
1. `npm run dev` → start screen → a full run → crash → end screen → instant retry, no console errors.
2. Speed visibly ramps; game is comfortably survivable for 15 s and brutally hard past 45 s.
3. All 24 catalog obstacles spawn in their phases and behave as described.
4. Stumble vs. crash distinction works; crashes are emergent physics ragdolls that play out visibly differently across 5 test crashes (different speeds/obstacles), with slow-mo.
5. Spins score and crash when landed mid-rotation; near-miss and threading popups fire.
6. All four phases visibly transition (light color, vegetation mix, density) while the sky stays blue and the mood cozy.
7. God rays, wind-sway wobble, butterflies/pollen/leaves, and blue-sky clouds present; the runner looks funny (floppy spring-driven limbs) even in normal running; the game looks genuinely charming in a screenshot at any phase.
8. Touch controls work on a phone (or DevTools device emulation); HUD readable in portrait.
9. 60 fps desktop / no leak: heap and draw calls flat across 5 consecutive runs.
10. Best score persists across reloads.

## 12. Out of scope (v1)

Leaderboards/backend, multiple characters or unlockables, sound-track music, gamepad support, save states, accessibility remapping (keep code input-mapped so it's easy later), photo mode.
