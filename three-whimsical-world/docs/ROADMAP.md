# Roadmap

In priority order: the first items are the user's requests for the next sessions, the rest ranked by realism gained. Move items to "Done" with the commit hash when finished.

## Next

0. **User's second queue (2026-11-01), in this order:**
   1. ~~TAA artifacts while moving and fps~~ (first pass done, see Done).
   2. A **Performance** panel section: every costly effect gets a switch, labeled with what it costs.
   3. Realism and polish: shore foam and breaking waves, caustics in shallows, rivers that visibly flow; dappled
      sun on the forest floor, light through thin leaves, a longer golden hour.
   4. Weather: rain (streaks, splashes and rings, wet ground, puddles, grey-violet sky, a rainbow after), morning
      mist that burns off, dew sparkle, weather that changes by itself, and a night sky (Milky Way, moon phases,
      shooting stars, aurora).
   The user wants it all to feel cozy and gorgeous.

0. **User's queue (2026-11-01), in this order:**
   1. ~~River banks~~ (done, see Done).
   2. ~~Teal shade~~ (done, see Done). The sky cap (see Done) made the sky near a low sun richer, but the
      sunset glow over the sea can still read pastel; the haze over land toward the sun is the remaining suspect.
   3. ~~Flicker~~ (TAA part done, see Done; waiting on the user's verdict in motion).
   4. ~~Ponds~~ (done, see Done). Possible follow-ups: ripple rings where a frog dives or a fish rises, a
      croak sound, dragonflies over the water.

3. **Valheim look pass**: match the user's reference shots in `reference/`, not just generic realism.
   - First pass landed: painted sky (`src/sky.ts`), Neutral tone mapping, luminous sun-glowing haze, lime grass,
     golden light. Side-by-side grid: `.playwright-mcp/look/compare2.jpg` (regenerate with `.playwright-mcp/compare.js`).
     Waiting on the user's verdict; next candidates: bigger sun bloom, cloud shapes, bluer shadows.
   - Sky: Valheim's painterly gradients (deep blue zenith → pink/peach near the sun → cyan horizon away from it),
     shifting through the day: rose-gold mornings, warm afternoons, magenta-violet dusk, deep blue nights. Likely a
     custom sky shader (or color grading layered on the physical sky) with per-time-of-day color stops.
   - Strong cyan-shadow / gold-highlight split toning; haze that glows pink-orange toward a low sun.
   - Done when: for each reference image, a matching screenshot (same time of day, similar framing) sits beside it
     and the user agrees the palette reads as Valheim.
4. **Whimsical pass** (user request; examples v1–v6 in `~/Downloads`): Valheim's dreamy moments, with lots of
   volumetric light and fog and rich colors contrasting in the same frame. Analyze the examples, recreate the
   effects, and put them behind one "whimsical" slider in the panel that cranks them all up or down.
   - First pass landed: "✨ whimsy" slider (default 0.6) drives a thicker teal/orange split haze, stronger beams,
     lens-flare ghosts, a soft glow pass, a saturated split-tone grade and drifting motes/fireflies (`src/motes.ts`).
     Next: user's verdict. (Sun glitter on water and falling leaves landed with the water and life passes.)
   - Pink-lit cloud wisps landed: a layer of high cirrus above the cumulus (`src/sky.ts`), fibrous streaks combed
     along the wind in patches. Faint white by day; around sunset they're lit pink from below, and they stay rosy
     in the afterglow after the sun has set; toward the sun they turn a deeper rose than the glowing sky behind.
     Their color is a `wisp` stop in the sky table; the amount rises with whimsy and goes when the clouds slider
     clears the sky. No fps cost. Shots: `.playwright-mcp/b2/g-k1.jpg` (before) and `g-k4.jpg`, `g-k6.jpg` (day and dawn).
   - Light pass landed: haze darkens in canopy shadow and a broad scattering lobe makes sunbeams between trunks;
     ground fog (amount / height / patchiness controls) pools in hollows; S-curve "depth" and three-way
     "color richness" grade (cyan shade, rosy mids, gold light).
   - Beam pass landed (`src/volumetric.ts`): the shadow-map march moved out of the atmosphere pass into its own pass
     at half resolution with twice the steps (80 on High), a depth-aware blur and a depth-weighted upsample, so the
     dither speckle is gone and trunk edges stay crisp. Samples are weighted by the haze's transmittance (near shafts
     count more) and the broad scattering lobe is five times as strong in forests, so beams read side-on as well as into
     the sun. Same fps. Shots: `.playwright-mcp/vol/` (`g-v5.jpg` before/after, `g-crop.jpg` noise).
     Still open: denser canopy shadow casters.
6. **Beauty pass: rich, lush forests and meadows** ("throw everything at it"). Candidates, pick by impact:
   - First pass landed: mushrooms (fly agaric, boletes) on damp forest floor, reeds and cattails on riverbanks,
     berry shrubs at forest edges (`src/undergrowth.ts`); butterflies over the meadows, birds wheeling overhead,
     leaves falling under the trees (`src/life.ts`). Shots: `.playwright-mcp/life/`.
   - Tall meadow landed: magenta fireweed spikes in drifts (thickest at forest-edge clearings), white-to-pink yarrow
     umbels, seeding grass tufts with golden to purplish heads, dandelion clocks, and the daisies/buttercups raised
     so their heads nod above the grass (`addTallMeadow` in `src/cover.ts`). ~1–2 fps. Shots: `.playwright-mcp/b2/`.
     Still open: wet-rock glints.
   - Deer landed (`src/deer.ts`, `public/models/deer.glb`): herds of a stag and a few does at forest edges that
     graze, look up, wander and bolt into the trees when you come within 26 m. The model was built in Blender from
     metaballs (no skeleton); the vertex shader swings the legs and lowers the neck from a per-instance pose, and
     the shadow pass uses the same pose. Shots: `.playwright-mcp/deer/`. Since rigged and animated, with fawns
     and staring (see Done). Next: spotted fawn coats, grazing steps, ears flicking on their own bones.
   - Forest floor landed: velvety moss cushions (speckled, bump-shaded) in damp patches, and litter cards of fallen
     leaves and spruce needles, thickest at the forest edge. Forest 32 fps (was 33). Shots: `b2/f2-*`.
   - Water mist landed: a thin layer at sea and river level (not the ground under the viewer), drawn into drifting
     wisps, thick at dawn and dusk and nearly gone by noon; scales with the ground-fog slider. Shots: `b2/r2-*`.
   - Undergrowth variety: berry bushes (raspberry, blueberry), thistles, mushrooms, dandelions and clover, tall
     grass tufts, reeds by rivers, fallen leaves and needle litter, moss carpets on forest floors.
   - Atmosphere: morning mist pooling in hollows and over rivers, drifting dust and pollen motes in sunbeams,
     fireflies at dusk, falling leaves.
   - Life: butterflies over flower drifts, birds circling, a deer or two at forest edges.
   - Light: richer dappled light under canopies, sun glints on wet rocks after rain.
   - Done when: walking from beach through meadow into forest at three times of day looks dense and alive in
     screenshots, compared against the references, at a playable frame rate.
7. (Done, see below: fractured procedural rocks.) Follow-up: concave shapes (two hulls fused) and layered strata
   for cliff bands.
8. (Done, see below: two-cascade sun shadows.) Possible follow-up: three 0.187's `SunLight` addon (native CSM in
   the WebGL renderer) if more cascades are ever needed; it would mean porting the volumetrics' shadow lookups.
9. (Done, see below: wind motion for the TAA, now on by default.) Possible follow-up: motion for deer, birds and
   butterflies (they move whole, so a per-object velocity would do).
10. (Done, see below: volumetric clouds.) Follow-ups: temporal reprojection so the march can run at quarter
    resolution, cloud-to-cloud shadowing in the haze probe, and the lighting probe seeing the volumetric clouds.
11. Small: (Done: grass blade detail per fragment (pale midrib, veins, darker edges, ~18% of blades with sun-dried
   brown tips), real flower heads (eight rounded petals around a golden center instead of flat heptagons); calmer fern greens, the eye opening up under a canopy, caustics and
   textured shore foam with the water.)

## Ideas for a gorgeous, rich land (suggested to the user, not yet prioritized)

- Color: wildflower meadows in drifts of purple heather, pink fireweed, yellow buttercups; autumn-tinted birches and
  rowans with red berries among the greens; lichen-orange and moss-green rocks.
- Light: god rays from clouds over the sea; aurora on clear nights; moonlit
  silver-blue nights; sun glitter on water.
- Life and motion: butterflies, birds, deer at forest edges, falling leaves, swaying reeds, drifting seed fluff.
- Landmarks: standing stones and rune stones, ruined towers, a Viking longhouse with smoke curling from the roof,
  a lone giant oak on a hill, waterfalls off mountain cliffs, burial mounds.
- Water: translucent turquoise shallows, foam, caustics, reflections (roadmap item).
- Weather: rolling morning mist, passing rain showers with wet sheen, rainbows after rain, wind gusts across grass.

## Later

- **Render the user's Valheim base** from their world file (`<World>.fwl` = name + seed, `<World>.db` = every
  built piece and terrain edit). Copy them in with the game closed. Building pieces need our own models
  (Blender MCP, or Tripo for props); Valheim's assets are copyrighted.
- Tripo-generated props (huts, longship, rune stones) through Blender MCP Premium or manual GLB downloads.

## Known issues

- ~35 fps deep in forest at night with the torch on (1280×720, headless). Lower render scale if needed.
- Forest light beams are moderate by default; the "volumetric light" slider strengthens them.
- Nights are very dark without the torch, by design.

## Done

- TAA artifacts in motion, cloud stripes, and tree cost (user, 2026-11-01):
  - **Motion vectors for things that move on their own** (`src/motion.ts`): the TAA reprojected the character
    (who moves with the camera) as if it stood still in the world, so running smeared the legs and cape into the
    grass. A `MotionPass` redraws only the movers (character, deer, frogs, fish, birds, butterflies, leaves) into a
    small target with their screen motion back to last frame (from last frame's object, instance and bone
    matrices) and their view depth; the TAA uses that motion where the depth matches the scene's. Running in third
    person keeps the character sharp now (`.playwright-mcp/taa/both.png`).
  - **Sharpen while moving** (`uSharpenMoving` 0.3 in `taa.ts`): each frame in motion resamples the history and
    softens it. A sharpen scaled by the pixel's motion (from 2 px/frame) doubles grass sharpness at a run (9.8 → 19.5)
    and leaves the still view alone (flicker 1.93 → 2.02; walking +10%).
  - **Cloud stripes**: the half-res cloud march used a fixed interleaved-gradient jitter that read as vertical
    stripes. The jitter now moves each frame (the TAA averages it) and the haze pass tent-filters the clouds.
  - **Trees cost 11-12 ms of a 21 ms frame** (`scripts/measure/perf.js`): 432 trees between 100 and 240 m were
    drawn with ~9.6k triangles each. Three geometry levels now (75 / 140 / 240 m, then impostors), the first two
    scaled by the preset's `treeDetail` (medium 0.8). Meadow 20.9 → 15.5 ms, forest 21.8 → 17.5 ms at 1280×720
    medium; the default view holds 60 fps.

- Motion flicker, the fog that wouldn't clear, and a switch for seeing in the dark (user, 2026-11-01):
  - **TAA while moving** (`uGammaMoving`/`uMinMaxMoving` in `taa.ts`): the variance box widened against still-view
    shimmer (048c990) let running smear grass into streaks with ghost flowers. The box now narrows to 1.0 σ once a
    pixel moves 3+ px/frame. Against a no-TAA reference with deterministic frames (`.playwright-mcp/move/ghost.js`):
    ghosting −25 %, flicker −12 % at walk and run speed; the still view is unchanged. Wind tracking was ruled out (on
    or off within 2 %). So were heavier new-frame weights and smaller jitter while moving (no gain, softer).
  - **Exposure pumping**: the see-in-the-dark meter swung a daytime forest's exposure ±6 % as you turned. Now
    the meter is smoothed over 1.5 s, eye adaptation only acts at night and in twilight, and forests by day open up
    through the eased canopy factor instead (1.3× → 1.55×). Daytime forest turning: 0.92-1.00, ≤0.65 %/frame.
  - **Fog that never cleared**: the open-air beam scatter and the light shafts ignored the haze slider, so haze 0
    still left a sunlit veil. Both now scale with haze (haze 0 = clear air). Default haze 0.0006 → 0.00045, the
    open-air beam density is a third lower, and forest beams are unchanged at default haze. The teal shade (0.6 →
    0.3, no forest boost) read as a blue fog under canopies.
  - **"See in the dark" on/off** in the post panel (plus a strength slider): off restores plain night, with no
    adaptation, no shadow toe and the old moonlight and fill.
- Sky no longer washes out, and dark places stay readable (user, 2026-11-01: "the sky still feels a bit washed
  out", "during the night i can't see anything in forest areas"):
  - The visible sky's brightest channel is soft-capped (knee 1.0, ceiling 1.6, `uSkyKnee`/`uSkyCeil` in `sky.ts` and
    the haze pass), so it stays out of the tone curve's shoulder. Scaling the whole color keeps the hue, so the noon
    horizon reads cyan-blue, not white (sky saturation 33 → 45). The haze pass caps sky pixels the same way after
    adding beams and glow; the sun disc is exempt, for bloom. Afternoon sun-side stops are warmer gold.
  - "See in the dark" (`nightVision`, panel slider, 0-2): `LuminancePass` (`src/exposure.ts`) meters the HDR
    frame, using a 32×18 log-luminance grid read back asynchronously every 4 frames, at no measurable fps cost.
    When the metered mid-tone falls below 0.05, the eye opens up: (0.05/m)^0.6, at most 4.5×. It opens over a
    couple of seconds and stops down quickly. The grade adds a shadow toe (`uShadowLift`). Moonlight is up 40 %, and
    the blue fill is brighter and also covers twilight. The night sky is a little brighter.
  - Forest at 23:00: brightness 18 → 29 (16 = black), now ferns and trunks read. Meadow at 01:00: 21 → 40. Daytime
    views are unchanged (they meter above the threshold).
- Ponds (`src/worldgen.ts` `ponds`/`pondEdge`, `src/pond-life.ts`): 14 small ponds, the first 45-115 m from spawn,
  on flat ground away from rivers and the coast. Each pond is a basin carved into the terrain with a disc of water at
  its level. The water shader measures depth from its own surface, so ponds are calm, teal-blue and clear, with only a
  few rafts of duckweed in the shallows. The shore has a moss carpet (less grass), silt under the water, moss
  cushions, a reed ring and rim boulders, some half-sunk; rock moss creeps down to the waterline near a pond (`uPonds`
  in `scanned-rocks.ts`). Pond life:
  - lily pads in rafts, about 30 % with white-to-pink flowers;
  - frogs on pads and the bank that croak (throat sac), hop around now and then, and dive when you come within
    3.5 m, then resurface on a free pad later;
  - fish wandering under the surface with a tail wave, resting now and then.

  Trees, logs, deer and dry ground cover keep out of the water, and the minimap shows ponds. Pond view 43 fps.
- Wind motion for the TAA, which is now on by default: every wind-swayed material (grass, ferns, flowers, reeds,
  shrubs, leaves) evaluates its sway at this frame's and last frame's time and writes how far it moved along the
  wind into the scene's alpha (1 + 8 × meters); the TAA moves each point back by that much before reprojecting.
  No extra pass, no fps cost (meadow 37.6 on vs 36.8 off). Swaying grass stays nearly as crisp as without TAA (edge
  energy 39.5 vs 37.6 with camera-only reprojection, 43 without TAA). While TAA is on, alpha-to-coverage materials
  use a plain alpha test (their partial alpha would read as motion), and the TAA smooths their edges. Also fixed
  in the TAA: its sharpen could overshoot a lone bright pixel (the sun through a leaf gap) to ~1000× and bloom it
  into a blob, and the history clip box now stays inside the neighborhood's range. Shots: `.playwright-mcp/taa/`
  (`g-ab2.png` off / old / new, `canopy-motion.png` motion view, `g-re2.jpg` blobs gone).
- Rigged, animated deer: one 23-bone skeleton for the doe and stag bodies, built and keyed by
  `scripts/blender/rig-deer.py` (bone-heat weights, then cleaned by region: antlers and ears on the head, no
  weights across legs). Five looping clips: Idle, Graze (the neck reaches down and the front legs splay so the
  muzzle is in the grass), Alert (head high, turning to look), Walk (lateral four-beat) and Gallop (bounding,
  spine flexing). Each deer is a skinned clone with its own mixer; states crossfade, and gait playback follows
  ground speed. New behavior: within 48 m deer stop and turn to stare at the player, and bolt inside 26 m. Some
  herds bring a fawn that keeps to its mother. Same fps (13 deer: 40 vs 40). Shots: `.playwright-mcp/deer/`
  (`g-rig.jpg`, `g-stare.jpg`, `fawn-crop.jpg`).
- White-out next to forests fixed: the camera's forest factor came straight from the forest mask, which runs on
  over beaches and water beside a forest. In open sunlit air there, the forest-strength beam scatter lit every
  step of the march and washed the frame out (user report: a beach at 95, -34 in the evening). The factor now
  averages the mask over a 12 m patch, counting only ground trees grow on, and the beam term has a soft ceiling.
  Shots: `.playwright-mcp/bright/` (`g-b.jpg` before, `g-r.jpg` after).
- Sunlit forests no longer wash out (user report: a forest hillside facing the afternoon sun). The forest's beam
  gain is tuned for mostly shaded air; where the sun reaches under the canopy nearly every step of the march is
  lit, and the gain painted a white veil over the whole view (bisected: beams off took the frame from 214 to 158
  mean luma; nothing else moved it more than 17). Now `litAround()` (`src/volumetric.ts`) averages the sun
  visibility on two rings of taps around each pixel, and the beam scatter falls back to open air's thin glow as
  that turns lit. Washed views: 214 → 164-180; dark forests and the beam shots unchanged; same fps. Shots:
  `.playwright-mcp/bright2/` (`ab1.jpg`, `ab2.jpg`: before left, after right) and `.playwright-mcp/vol/g-nab.jpg`.
- Less grass shimmer under TAA (user report: "weird almost flickering effect, specially in the grass" when
  moving). Measured with `.playwright-mcp/flicker/` scripts: consecutive frames captured inside the composer's
  render, flicker = mean |second temporal difference| of luma over a grass crop, 3 runs each. With the wind off
  and the camera still, TAA alone changed the frame 1.40/frame vs 0.04 off: it was chasing the jitter. Causes: a
  tight variance box (1 sigma, bounded by the neighborhood min/max) clamped the history to each jittered, swaying
  frame, and the 0.18 sharpen amplified the residue. Now 1.5 sigma unbounded, sharpen off: in the wind, 6.1 -> 3.9
  standing and 5.5 -> 4.1 walking (TAA off: 4.3 / 7.3). About 10% less edge energy; no sparkles back along crowns
  against the sun. Knobs: `__app.post.taa.uniforms.uGamma / uMinMax`, `copyUniforms.uSharpen`.
- Teal-blue shade (Valheim's shaded forest floor is a luminous teal; ours was near-black green). The volumetric
  march also records whether each visible surface sees the sun (one shadow lookup at the ray's end, carried
  through the blur in B). The atmosphere pass shifts shaded surfaces' hue toward teal (luma kept) and lifts them
  with a little teal skylight scaled by the sky's brightness overhead, more under a canopy; cloud shadow counts
  as shade. Panel: Time > "teal shade" (default 0.6). Shots: `.playwright-mcp/hue/gs2.jpg` (off left, on right).
- Rocky river banks (user report: "banks look super fake and simple", plus a glowing yellow sawtooth along the
  water). The sawtooth was beach sand colored by height per vertex: on a steep bank the thin sand band zig-zagged
  across the 2.5 m triangles. Now `riverEdge` (`src/worldgen.ts`) is a signed distance to a jagged water edge
  (bays and points at two scales), and the bank is a low gravel shelf at the water, then ledges (flat treads, steep
  rock risers, at least 8 m wide so the mesh holds them) climbing to the land, with ridged outcrops on the face.
  River shores are colored gravel and wet stone, risers rock; sand stays on the sea beach and never on steep ground.
  A boulder pass lines the waterline and shelf and lodges blocks on the bank faces (`src/rocks.ts`). Note: the
  jagged edge reshuffles the random tree layout across the map (same seed, different world). Shots:
  `.playwright-mcp/river/g-ab2.jpg` (old left, new right).
- Gorge views no longer drown in haze. Two causes, both older than the banks: ground fog is measured from the
  ground under the camera and allowed 20x its density below it, so a gorge or valley seen from its rim filled with
  a wall of mist (now floored at 0.7 layer heights below, still pooling in hollows); and the forest's 7x haze ran
  along the whole ray, now only its first 70 m. Forest beam shots unchanged. Shots: `.playwright-mcp/river/g-h2.jpg`,
  `g-mist.jpg`, `.playwright-mcp/vol/g-ncd.jpg`.
- Valheim's hue split (user request: "blue to purple to orange, more saturated sky"). Blending the cool sky or
  haze into the warm sun side in RGB passed through grey; now the middle of each blend is pushed toward violet-pink
  (green down, red and blue up), in the sky's horizon and vertical gradients (strongest at a low sun) and in the
  haze tint. Sunlight scattered by the haze (beams, shafts, the forward glow) is orange rather than the pale sun
  color, deeper in forests. The golden-hour and afternoon stops near the sun are less pale, so tone mapping keeps
  their orange instead of bleaching it. Panel: Time > "hue split" (0 = no violet stop or orange scatter, default 1, up to 2). Shots:
  `.playwright-mcp/hue/` (`g1.jpg`, `g2.jpg`: split off left, on right; `g3.jpg`, `g4.jpg`: before vs final).
  Next: teal-blue shade on the ground under the canopy (Valheim's shaded forest floor is blue, ours black-green),
  and the sun's glow at sunset still bleaches toward white over the sea.
- Volumetric clouds (`src/clouds.ts`): cumulus raymarched at half resolution through a slab around the cloud
  layer, shaped by the same 2D cover field as the cloud shadows (so shadows still match). A cumulus profile (flat
  bases, tops as tall as the cover is thick) is eroded by billowing 3D noise. Three steps toward the sun
  self-shadow them, with a powder term and a forward silver lining, colored by the sky table's `cloudLit` /
  `cloudShade`. Around sunset and in the afterglow they glow pink over violet bases. Distant ones sink into the
  horizon haze. The visible sky drops its painted cumulus while they're on; the haze, reflection and lighting
  probes keep them. Steps per preset: Low off (painted), Medium 16, High 24, Ultra 32. Cost on High: about 2 fps in
  ground views (meadow 36 to 34), 5 looking at open sky (52 to 47). Shots: `.playwright-mcp/b2/g-c3.jpg`,
  `g-c5.jpg`.
- Fractured procedural rocks (`src/fractured-rocks.ts`): lumpy point clouds cut by random fracture planes and
  wrapped in a convex hull, with creased normals, so split faces meet at sharp edges between weathered sides. Five
  kinds (boulder, block, slab, crag, standing stone), two variants each, generated per world seed. Vertex colors
  carry granite grain, a darker base and orange lichen on the sides. The scanned rock texture (ground layer 3) is
  projected triplanar in world space with its normal map, under the scans' moss. They join the 17 scans in the same
  instanced field. Outcrop cores lean on them, and the stone ring is now tall split slabs with broken tops. The
  lumpy-sphere fallback is gone. Same fps. Shots: `.playwright-mcp/rocks/` (`g-r3.jpg`, `g-r4.jpg`).
- Ground bounce in the ambient light: the lighting probe (only the PMREM that lights the scene; the haze and water
  keep the painted sky) now sees sunlit olive land below the horizon instead of blue haze, and a slightly less
  saturated sky above. Shaded white birch bark went from cobalt (50, 83, 128) to a muted steel grey-blue
  (55, 67, 93); the grade's contrast still cools it a little, as Valheim's shade does. Shots: `.playwright-mcp/vol/`
  (`g-w1b.jpg`, `bis-g-*.png` grade bisect).
- Two-cascade sun shadows (`src/cascades.ts`): a sharp near map (60 m half-width, 4096 on High) redrawn every
  frame and a wide far map (600 m on High) redrawn every 6 frames or when the sun turns, blended at the edge of the
  near square. The far light has zero intensity and exists only for its map; patched shader chunks light with the
  near light and pick the shadow per fragment. Only full-detail trees draw into the near map; mid-detail trees and
  sun-facing impostors draw into the far map alone (layer `FAR_CASTERS`), so distant groves and forest edges now
  cast shadows. The far shadow coordinate is computed per fragment, not passed from the vertex shader: the extra
  per-vertex coordinate cost ~3 ms on the vertex-heavy trees and cover. Cost now 0–2 fps (High meadow 38 vs 39,
  forest 33 vs 33, hill 39 vs 41); off on Low. The volumetric beams march through both maps. Shots: `.playwright-mcp/csm/`.
- Realistic water (`src/water.ts`): drawn by its own pass after the opaque scene, it refracts the seabed through
  the waves with per-channel absorption (turquoise shallows, deep blue offshore), caustics on the shallow bottom,
  screen-space reflections of the land and trees (sky probe where they miss; steps scale with quality), a thin
  dissolving waterline, lacy foam lapping in and out, and sun glitter (raised by whimsy). Shots:
  `.playwright-mcp/water/`.
- Less fog and sun glare. A bisect showed ground fog lit by the bright haze toward the sun made most of the
  white-out, not the disc or bloom. Ground fog is now 0.22 and burns off as the sun climbs, its mist is capped in
  brightness, haze is 0.0006 with half the whimsy boost, the forward-scatter lobe is tighter and capped, the sky's
  middle glow is dimmer, the grade lifts highlights half as much, and the eye adapts (up to −22% exposure) while
  looking into the sun. Before/after grid: `.playwright-mcp/glare/g3.jpg`.
- Graphics quality presets (Display → graphics quality: Low / Medium / High / Ultra, `src/quality.ts`) scale
  render scale, sun shadow map and reach, grass and fern density and reach, volumetric steps, AO resolution,
  glow pass and motes together; FPS counter bottom-left (P toggles). At 1280×720 in the headless browser, back to
  back: Low 60, Medium 60, High 48, Ultra 37 fps, the same in meadow and forest.
- Textured terrain: five CC0 Poly Haven scans (meadow soil, forest floor, earth, rock, sand) splatted by biome and
  slope as detail over the vertex-color palette, triplanar rock, normal maps (`src/ground.ts`). H toggles the panel.
- Playable Viking (Quaternius CC0, assembled in Blender) with idle/walk/jog/sprint/jump clips, third-person
  spring-arm camera (V toggles first person), torch in hand. See `docs/CHARACTER.md`.
- Persistent settings: every panel value survives a reload (`src/persist.ts`, `?defaults` skips it); "Reset to
  defaults" restores them and regenerates the world if world settings changed.
- Scanned rocks: 17 Poly Haven shapes (`npm run assets`), two detail levels, moss slider. `boulder_01` was left
  out because it won't simplify below ~54k triangles.
- `33ddfd9` Terrain, sky, sea. `56dbf71` Grass, trees, LODs. `6141e7c` Post-processing, walking.
- `3911bc6` Grass clumps, tree crowns, AO, far land, rocks. `3a6fea0` Tree impostors, sea, beach.
- `a9b7fac` World generator panel, forest biome, ground cover, time of day.
- `d232660` Torch, volumetric sunlight, ferns. `90d31e7` Minimap, realistic fire, variety, display settings.
