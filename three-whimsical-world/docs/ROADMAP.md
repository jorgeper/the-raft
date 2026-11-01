# Roadmap

In priority order: the first items are the user's requests for the next sessions, the rest ranked by realism gained. Move items to "Done" with the commit hash when finished.

## Next

0. **User's third queue (2026-11-01):** every open item below, except buildings: the world should feel virgin
   wilderness for now (no longhouses, towers, campfires or other built things; buildings come later). Then a
   **soundscape** (wind, birds, crickets and owls, frogs, surf, rain, torch crackle, footsteps by surface).
   1. ~~Moonlit nights~~ (done, see Done).
   2. ~~God rays from clouds~~ (done, see Done).
   3. ~~Rowans with red berries, lichen-orange rocks~~ (done, see Done).
   4. ~~Lone giant oak on a hill~~ (done, see Done).
   5. ~~Waterfalls off gorge cliffs~~ (done, see Done).
   6. ~~Wet-rock glints~~ (done, see Done).
   7. ~~Denser canopy shadow casters~~ (checked 2026-11-01: leaf cards already cast solid shadows, and the forest
      floor is shaded with beams through the gaps; `.playwright-mcp/wild/can0.jpg`. No change.)
   8. ~~Concave rocks and cliff strata~~ (done, see Done).
   9. ~~Snow~~ (done, see Done).
   10. ~~Deer grazing steps and ear flicks~~ (done, see Done).
   11. Cloud follow-ups, reviewed 2026-11-01 and deferred: the clouds come out smooth with the TAA off (no march
       noise; `.playwright-mcp/wild/cl0.png`) and meadows hold 60 fps, so temporal reprojection would only buy speed
       not needed yet. The haze, reflection and lighting probes draw the painted clouds, which share the volumetric
       ones' cover field, so they already line up; cloud-to-cloud shadowing there would be subtle for its cost.
   12. Look-pass candidates, reviewed: bluer shadows are the "teal shade" (done in the first queue), cloud shapes
       came with the volumetric clouds, and the sun already sits in a large warm glow with a pink halo
       (`.playwright-mcp/wild/sun0.jpg`); a bigger bloom would veil the frame. Left for the user's verdict.
   13. ~~The soundscape~~ (done, see Done).

0. **User's second queue (2026-11-01), in this order:**
   1. ~~TAA artifacts while moving and fps~~ (first pass done, see Done).
   2. ~~A **Performance** panel section~~ (done: `perf` in main.ts; switches fold into the preset in `applyPerf`).
   3. ~~Realism and polish~~ (surf, flowing rivers, drifting dapples, longer golden hour: see Done; caustics were
      already there).
   4. ~~Weather and night sky~~ (done, see Done), and since then splashes, wet rocks and bark (see Done). Snow since
      landed (see Done).
   The user wants it all to feel cozy and gorgeous.

0. **User's queue (2026-11-01), in this order:**
   1. ~~River banks~~ (done, see Done).
   2. ~~Teal shade~~ (done, see Done). The sky cap (see Done) made the sky near a low sun richer, but the
      sunset glow over the sea can still read pastel; the haze over land toward the sun is the remaining suspect.
   3. ~~Flicker~~ (TAA part done, see Done; waiting on the user's verdict in motion).
   4. ~~Ponds~~ (done, see Done), with ripple rings and dragonflies since. Possible follow-up: a croak sound.

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
   - First pass landed: "✨ whimsy" slider (default 0.9 since 2026-11-01) drives a thicker teal/orange split haze, stronger beams,
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
     Denser canopy shadow casters: checked, not needed (see the third queue).
6. **Beauty pass: rich, lush forests and meadows** ("throw everything at it"). Candidates, pick by impact:
   - First pass landed: mushrooms (fly agaric, boletes) on damp forest floor, reeds and cattails on riverbanks,
     berry shrubs at forest edges (`src/undergrowth.ts`); butterflies over the meadows, birds wheeling overhead,
     leaves falling under the trees (`src/life.ts`). Shots: `.playwright-mcp/life/`.
   - Tall meadow landed: magenta fireweed spikes in drifts (thickest at forest-edge clearings), white-to-pink yarrow
     umbels, seeding grass tufts with golden to purplish heads, dandelion clocks, and the daisies/buttercups raised
     so their heads nod above the grass (`addTallMeadow` in `src/cover.ts`). ~1–2 fps. Shots: `.playwright-mcp/b2/`.
     Wet-rock glints since landed (see Done).
   - Deer landed (`src/deer.ts`, `public/models/deer.glb`): herds of a stag and a few does at forest edges that
     graze, look up, wander and bolt into the trees when you come within 26 m. The model was built in Blender from
     metaballs (no skeleton); the vertex shader swings the legs and lowers the neck from a per-instance pose, and
     the shadow pass uses the same pose. Shots: `.playwright-mcp/deer/`. Since rigged and animated, with fawns
     and staring (see Done); fawns are spotted now; grazing steps and ear flicks since (see Done).
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
7. (Done, see below: fractured procedural rocks; concave fused shapes and cliff strata since, see Done.)
8. (Done, see below: two-cascade sun shadows.) Possible follow-up: three 0.187's `SunLight` addon (native CSM in
   the WebGL renderer) if more cascades are ever needed; it would mean porting the volumetrics' shadow lookups.
9. (Done, see below: wind motion for the TAA, and `MotionPass` in `src/motion.ts` for the character, deer, frogs,
   fish, birds, butterflies and leaves. The TAA is off by default since 2026-11-01, see Done.)
10. (Done, see below: volumetric clouds.) Follow-ups: temporal reprojection so the march can run at quarter
    resolution, cloud-to-cloud shadowing in the haze probe, and the lighting probe seeing the volumetric clouds.
11. Small: (Done: grass blade detail per fragment (pale midrib, veins, darker edges, ~18% of blades with sun-dried
   brown tips), real flower heads (eight rounded petals around a golden center instead of flat heptagons); calmer fern greens, the eye opening up under a canopy, caustics and
   textured shore foam with the water.)

## Ideas for a gorgeous, rich land (suggested to the user, not yet prioritized)

- Color: ~~purple heather drifts~~, ~~autumn-tinted birches~~, ~~rowans with red berries~~, ~~lichen-orange rocks~~
  (done, see Done).
- Light: god rays from clouds over the sea; aurora on clear nights; moonlit
  silver-blue nights; sun glitter on water.
- Life and motion: butterflies, birds, deer at forest edges, falling leaves, swaying reeds, ~~drifting seed fluff~~.
- Landmarks: ~~standing stones, rune stones, burial mounds~~, ~~a lone giant oak on a hill~~ , ~~waterfalls~~ (done, see
  Done). Buildings (ruined towers, a longhouse with smoke) wait until the user brings
  buildings back: the world stays virgin wilderness for now.
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

- Vibes (user, 2026-11-01): a "🎨 vibe" dropdown at the top of the panel, with a strength slider and `?vibe=name`.
  Whimsical (the tuned cyan-and-gold look) is the default and switches the vibe pass off, so it stays pixel for
  pixel as it was. The others are one display-space pass after the grade (`src/vibes.ts`): Amethyst (purple
  monochrome), Honey hour (warm gold haze), Frostbound (cold silver blue), Storybook (Kuwahara brush strokes, banded
  light, ink silhouettes from the depth buffer, paper), Ember (red sky at Ragnarök), Old film (faded teal blacks,
  red halation, grain) and Otherworld (hues turned: purple woods under a lime-gold sky). About 1 ms at most.
  Then three more: Horror film (bleached sickly green, crushed blacks, projector flicker, lens fringes, heavy
  grain), Low poly (the ground as flat 7 m triangles anchored in the world: each pixel is found in the world from
  the depth buffer, its facet's slope comes from a baked heightmap (`bakeHeights`, ~0.2 s on first use and after
  each new world), it takes one color from where the facet's middle is seen, and the light of its own slope; trees
  and rocks get the brush strokes) and Pixel art (4 px chunky pixels at 720p, six steps per channel with Bayer
  dithering, dark outlines). 1-3 fps each in the headless browser.

- Changing wind (user, 2026-11-01): with "wind changes by itself" on (the default), `WindDrift` in `src/wind.ts`
  moves the wind through spells around the slider's strength: still (0.1-0.35×), breezy, blustery and now and then
  a gale (2.5-3×), easing between them over 10-30 s, with rain bringing at least a fresh blow. Grass, trees, seed
  fluff, the clouds' drift and the wind's sound all follow it; "wind now" in the panel shows what's blowing.
  `?wind=2` holds it steady for screenshots. Sound volume defaults to 0.3.

- Sound and sea fixes (user, 2026-11-01): the mix is half as loud; the waterfall roar now fades out by 200 m
  instead of hissing across the map; wind and leaves follow the gusts squared, so lulls go quiet; surf and rivers
  fall off with the square of distance. No cuckoo; birds call about four times a minute at midday (more at dawn).
  The sea's concentric moiré rings from high up are gone: `waveGradient` in `src/water.ts` fades each wave once
  its wavelength approaches the pixel footprint (`dFdx`/`dFdy` of the world position).

- Soundscape (user, 2026-11-01): `src/audio.ts`, all synthesized with Web Audio (no sample files), starting on the
  first click or key press. N toggles it (the context suspends while off); a Sound panel section has on/off and
  volume. Beds of filtered noise: wind on the same gust rhythm as the grass (louder up high and in the open, hushed
  in woods, a thin whistle when it blows hard), leaves rustling in the canopy, surf breaking every 5-9 s near the
  sea, rivers babbling, rain (with patter on leaves and drips under the trees), the torch's flame and crackles, and
  a positional roar at the foot of each waterfall. Creatures: birds by day with a dawn chorus (robin-like warbles,
  chaffinch trills, a fluting blackbird, sparrow chirps, a skylark high over the meadows, a woodpecker
  in the woods, gulls by the sea), crickets on clear nights in the open, tawny owls from the forest, frogs at the
  nearest pond (a chorus after dusk). Footsteps keep the character's legs' rhythm (`Character.footfalls()`: two per
  gait cycle) and change with the ground: grass, leaf litter, dirt, sand, snow, stone and splashing water; a landing
  thuds. Snow muffles the mix. Birds, owls, frogs and falls are placed in the world (equal-power panners on the
  camera) with a generated reverb. No fps cost. Checked by measuring level and spectrum in six scenes
  (`__app.sound`): nothing clips, crickets carry the night, rain the highs, birds the dawn forest.
  Not yet: deer hooves when a herd bolts, splashes when jumping into water, thunder.
- Deer grazing steps and ear flicks (2026-11-01): a grazing deer now and then takes a step or two to fresh grass, a
  slowed Walk blended under the Graze (the mixer averages weights, so the head stays mostly down). Ears flick on
  their own clocks (quicker while the deer looks or stares) without ear bones: `refine()` tags the ear vertices
  (`aEar`) and the vertex shader turns each ear about its base in the rest pose, before skinning, so it still rides
  on the head. Each deer has its own material clone for its ear uniform (same program); copying `onBeforeCompile`
  onto the clones matters, since `Material.clone()` drops it. Shots: `.playwright-mcp/wild/ear0.jpg` / `ear1.jpg`.
- Snow (2026-11-01): a "Snow" weather pick (panel, or `?weather=snow`; never chosen by the auto weather, which is
  summer's). Soft flakes drift down in little loops in a box around the camera (`Snow` in `rain.ts`, scaled by the
  raindrops perf slider); the air thickens. `weather.snowCover` builds over about a minute while it snows and
  melts over a few minutes after (faster in sun), wetting the ground as it goes; `uSnow` whitens what faces up:
  the terrain in drifts (thin on slopes, none on cliffs or the beach; puddles and wet hidden; normal map softened),
  rock tops, the outer leaves and branch tops of every tree, far impostors speckled, moss cushion tops, and the
  grass sinks into the blanket with frosted, straw-pale tips. 60 fps in the meadow. Shots:
  `.playwright-mcp/wild/snow3.jpg` (meadow), `snow4.jpg` (forest), `snow5.jpg` (gorge).
- Cliff strata and concave rocks (2026-11-01): steep rock in the terrain shader is bedded in warped, gently tilted
  layers of warm ochre and cool grey a meter or two thick, with seams of varying depth between beds; it carries
  the gorge walls from afar where the scans fade (`terrain.ts`). Two concave fractured kinds join the field
  (`fused` in `fractured-rocks.ts`): `split`, a boulder cracked in two with the halves leaning apart, and `pair`,
  a crag with a lower block shouldered against it. `world.rocks.placements` now lists every rock with its shape
  name, for finding shots. Shots: `.playwright-mcp/wild/strata2.jpg`, `split0.jpg`, `split1.jpg`, `pair1.jpg`.
- Wet-rock glints (2026-11-01): as rocks soak after rain, scattered beads of water (16 per meter, about half the
  cells, off the moss) get their own tilted normals and near-mirror roughness, so points flash as the sun or the
  eye moves; the soaked stone around them is glossier than before (roughness 0.4). Shots:
  `.playwright-mcp/wild/wetA0.jpg` (dry), `wetB2.jpg` (wet, into the sun).
- Waterfalls (user, 2026-11-01): worldgen (`waterfalls` in `worldgen.ts`) scans the gorge rims for the highest drops
  straight into a river (lip on land at least 10 m up, water within 12 m, drop over 11 m, sites 160 m apart, kept
  off the world's edge); the default world has two, at (-732, -576) and (-676, 640). `src/waterfall.ts` hangs a
  ribbon off each lip along a parabola that clings to the face, shaded with ropes of streaks, tumbling foam slugs,
  frayed edges and white water at the lip and the plunge; spray puffs rise from the base and rings spread on the
  river while the player is near. The blend leaves the target's alpha (TAA motion) alone. Shots:
  `.playwright-mcp/wild/wfe0.jpg` (day), `wfe3.jpg` (moonlit). Not yet: a stream feeding the lip, the roar (sound
  queue).
- Lone giant oaks (user, 2026-11-01): worldgen picks two `oak` landmarks on the most prominent open, flattish crests
  (height above a 60 m ring; one 110-320 m from the start, at (85, -180) in the default world, one further off).
  Each is a ~24 m 'Oak Large' with a thick gnarled trunk and long sideways limbs (`giantOak`, `GIANTS` in
  `trees.ts`) in a 14 m clearing that keeps other trees and boulders away (grass and flowers still grow under it).
  Shots: `.playwright-mcp/wild/oak-3.jpg` (silhouette at sunset), `oak-5.jpg`.
  Also: the cloud-ray field is marched the full 3 km whatever stands in front (sky gaps between leaves upsampled
  the leaves' value as blocks), and the 3x screen-space shaft boost under broken cloud is gone (it made starbursts
  through foliage; the world-space rays do that job).

- Rowans and lichen (user, 2026-11-01):
  - **Rowans** (`rowan` in `src/trees.ts`): two slim ash-leaved species among the young trees (forest edges, lone on
    the meadow, ~390 in the default world) hung with clusters of scarlet berries: octahedra placed under random
    outer-shell leaves, swaying with the crown (`buildBerries`, `berryMaterial`), on the two nearer detail levels.
    No measurable fps cost. Adding species reshuffles which young tree grows where (positions are unchanged).
  - **Lichen** (`patchMoss` in `src/scanned-rocks.ts`, so scanned and fractured rocks both): orange crustose blotches
    and speckles, thickest on rocks near the sea, and pale grey-green map lichen elsewhere, under the moss and not in
    overhangs. Shots: `.playwright-mcp/wild/rw-4.jpg`, `li-4.jpg`.

- Crepuscular rays from broken cloud (user, 2026-11-01): the volumetric pass also marches each ray 3 km out (16
  steps, squared spacing, below the cloud base) through the clouds' coarse shadow field (the sky's fbm, first three
  octaves) and writes how much of that air sees the sun into its spare alpha channel (blurred and upsampled with the
  rest). The atmosphere pass brightens lit shafts and dims shadowed ones (multiplied, hue kept) with a forward
  phase, so rays fan from the sun through the gaps; only under broken cloud (0.08–0.9 cover), outside forests.
  `__app.post.atmosphere.uDebugVolumetric.value = 2` shows the field. ~2 fps at medium (57 vs 59). Clouds also
  block the screen-space sun shafts and flares now. The cyan cast of shallow water toward a low sun is gone (the
  refracted seabed is capped at luma 1.1). Shots: `.playwright-mcp/wild/gr7-f.jpg` (rays), `gr5-*-dbg.jpg` (field).

- Moonlit nights, and the black holes in the night sky (user, 2026-11-01):
  - **Black cloud-shaped holes at night** (older bug): in a dark navy sky the grade's teal shadow tint and saturation
    push drove red below zero, the luminance went <= 0 and the S-curve's ratio multiplied the pixel to black. Clouds
    and a far island at night, slightly darker than the open sky, turned into black cut-outs that hid the stars.
    The grade now clamps channels at zero after contrast.
  - **Moonlit clouds**: the moon lights them at night (`uMoonLight`, from night × phase × overcast): silver tops,
    blue-grey bellies, a silver lining toward the moon; the volumetric march self-shadows toward the moon.
  - **Silver-blue moonlight**: color (0.62, 0.73, 1) scaled by phase (full 1.15×, new 0.4×); a wide glow around a
    bright moon in the sky; the haze toward the moon is silver instead of sunset orange, with no violet hue split.
  - **Rod vision** (`uScotopic` in the atmosphere pass): dim surfaces at night lose color toward silver-blue (60%),
    bright ones and the torch's pool of light stay in color. The grade eases its saturation push and teal shadow at
    night, so the sky reads deep navy instead of neon royal blue.
  - The sea glowed brighter at night than at noon: the water's light carried the light's color but not its
    strength while night exposure is ~7×. Now scaled by the light's intensity.
  - Lens-flare ghosts no longer follow the moon (`uFlareOn`). Aurora layers are dithered per pixel, so they blend
    into one curtain instead of horizontal bands. A cyan blob at the waterline under a low sun is gone: the
    refracted seabed (the wet sand's glint) is capped before the water absorbs its red.
  - Shots: `.playwright-mcp/wild/` (`base-*`, `b-*` before; `n5-*`, `n6-torch.jpg` after).

- Dreamier defaults, TAA off (user, 2026-11-01): whimsy 0.6 → 0.9, teal shade 0.6, hue split 1 → 1.4, cyan/gold
  tint 0.55 → 0.75 (a more violet sky, rosier haze toward the sun, teal shade, richer golden sunsets; shots
  `.playwright-mcp/polish/dr-*`). Temporal AA is off by default: in motion it still smeared and ghosted; grass edges
  fall back to alpha-to-coverage MSAA. Stored panel settings only keep values the user changed, so these reach
  everyone who hasn't touched those sliders. Also a "pollen & seed fluff" switch under whimsy.

- The rest of the queue (user, 2026-11-01, after "fix the rest in the roadmap"):
  - **Weather fixes**: picking a weather in the panel now lands in seconds (`Weather.pick`; auto mode still drifts
    over ~40 s), and the white stripes on river mouths are gone: the streak frame sheared where the flow turned, so
    the white water is now flecks advected along the flow.
  - **Rain splashes** (`Splashes` in `src/rain.ts`): little rings and crowns where drops land, near and ahead of you.
    **Wet world**: rocks (`patchMoss`) and tree bark darken and gloss in rain, moss less so.
  - **Pond life**: rings spread where a frog dives or lands on a pad and where a fish rises (`addRipple` in
    `src/water.ts`); dragonflies hover and dart over the ponds by day, dipping to the water.
  - **Landmarks** (`src/landmarks.ts`, sites in `worldgen.ts`): barrow cemeteries of two to four grassy mounds
    (part of the land's height, so grass and flowers grow on them) with a rune stone beside each; lone rune stones
    and two more stone circles out on the meadows; a rune stone just west of the ring above the beach, facing the
    start. Rune stones carry a serpent band with runes in its body and a ring cross, red paint worn off in places,
    the grooves shading like cuts. Trees and boulders keep clear (`clearing`), checked after their random draws so
    the forest doesn't reshuffle. Shots: `.playwright-mcp/polish/lm-*.png`.
  - **Autumn touch**: birches turn gold and young broadleaf copper in drifts (instance color with little blue marks
    an autumn tree; `AUTUMN_LEAVES` in `src/impostor.ts` serves leaves and impostors). Shots: `au-*.png`.
  - **Seed fluff** (`src/fluff.ts`): dandelion and thistle down on the wind over open meadow on fine days, glowing
    when backlit. No measurable fps cost. Shots: `fl-*.png`.
  - **Heather**: a `heath` field (higher open ground) thins and shortens the grass, tints the sward mauve and grows
    heather cushions (`createHeatherGeometry`). Shots: `he-*.png`.
  - **Deer**: spotted fawns (their own material, spots placed in the rest pose); fixed blue-violet blotches on the
    white rumps (vertex colors brightened past 1 wrapped around in their Uint16 attribute).
  - All at 60 fps at medium in the shots, except looking into a low sun past the forest edge at the start (48, the
    same as before these changes).

- Weather and the night sky (user, 2026-11-01):
  - **Weather that changes by itself** (`src/weather.ts`): clear → fair → cloudy → overcast → rain and back, a few
    minutes per state, on a Markov chain. Cloud cover and greyness drift over ~40 s, rain starts once the sky has
    greyed. Panel: Time & weather → weather (auto, a fixed state, or manual = the old cloud slider); `?weather=rain`.
  - **Overcast**: the sky blends toward grey-violet; the sun's direct light drops to 18%, the ambient rises,
    beams fade, and the haze, water glitter and grass translucency lose the sun's warmth and the violet hue split
    (they had tinted rainy haze pink). The horizon under the deck stays only a little brighter than the clouds.
  - **Rain** (`src/rain.ts`): 12k streaks in a box that wraps around the camera, drawn after the TAA, hidden behind
    land and trees by testing a clean copy of the scene depth (`WaterPass.depth`, the overlay bug below).
    Rings on the sea, ponds and rivers; ground darkens; bare flat ground gathers puddles with real reflections and
    rings (not under the meadow: a glossy floor there reflected the sky up between the blades). Under 0.3 ms.
  - **Rainbow** after a shower when the sun is out and below 40°: primary with red outside, a fainter reversed
    secondary, brighter sky inside the bow. Drawn in the atmosphere pass after the clouds (in the sky dome the
    clouds hid it), over the sky and far land.
  - **Morning mist** that lies thick at dawn (heavier after rain) and burns off by 10:00; **dew** glints on the blades.
  - **Night sky**: Milky Way with dust lanes, a moon disc with phases (advancing a day each night) and seas, shooting
    stars, and aurora curtains over the north (green foot, violet top, rays keyed to the compass bearing so they
    don't alias near the horizon). Panel sliders: northern lights, moon phase.
  - Bugs found on the way: the overlay (motes, rain) sampled `target.depthTexture` while drawing into that same
    target (with the TAA on the swap parity puts the overlay there), so the depth test read garbage; and a local
    named `flat` (a GLSL ES 3 keyword) failed the terrain shader, which showed the sea plane through the ground.
  - All shots 60 fps at medium (`.playwright-mcp/polish/w-*.png`).
- Drifting sun flecks and a longer golden hour (user, 2026-11-01):
  - Tree leaves cast their shadows through a wind-aware depth material (`leafDepth` in `trees.ts`): the dapples on
    the forest floor drift with the crowns' sway (not the leaf flutter, so they don't shimmer). Forest +0.4 ms.
  - With the clock running, it slows to 0.42× while the sun is below ~20° (and in the first dusk glow), so sunrise and
    sunset light last about twice as long.
- Surf and flowing rivers (user, 2026-11-01):
  - **Surf** (`water.ts`): lines of breaking waves roll up the beach. The bottom depth stands in for distance from the
    shore, so the crest phase follows depth and creeps into the shallows, a solid front tearing into lace behind it
    and broken into sets along the shore (`.playwright-mcp/polish/v3-shore.png`).
  - **Rivers flow**: rivers were filled by the sea plane, so their ripples rolled ashore like the sea's. A flow map
    (`bakeFlow`, from the river centerlines `worldgen.riverCenters`) carries each river's downstream direction; ripples
    drift along it (two cross-faded flow-map phases) and white-water streaks thicken over the shallows at the banks.
  - Medium still holds 60 fps at the river and the beach.
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
