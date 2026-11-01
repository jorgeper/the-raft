# Roadmap

In priority order: the first items are the user's requests for the next sessions, the rest ranked by realism gained. Move items to "Done" with the commit hash when finished.

## Next

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
     Next: sun glints on water, falling leaves, pink-lit cloud wisps, user's verdict.
   - Light pass landed: haze darkens in canopy shadow and a broad scattering lobe makes sunbeams between trunks;
     ground fog (amount / height / patchiness controls) pools in hollows; S-curve "depth" and three-way
     "color richness" grade (cyan shade, rosy mids, gold light). Side-on beams are still faint: try a dedicated
     beam pass at half resolution with more steps, and denser canopy shadow casters.
6. **Beauty pass: rich, lush forests and meadows** ("throw everything at it"). Candidates, pick by impact:
   - First pass landed: mushrooms (fly agaric, boletes) on damp forest floor, reeds and cattails on riverbanks,
     berry shrubs at forest edges (`src/undergrowth.ts`); butterflies over the meadows, birds wheeling overhead,
     leaves falling under the trees (`src/life.ts`). Shots: `.playwright-mcp/life/`.
   - Tall meadow landed: magenta fireweed spikes in drifts (thickest at forest-edge clearings), white-to-pink yarrow
     umbels, seeding grass tufts with golden to purplish heads, dandelion clocks, and the daisies/buttercups raised
     so their heads nod above the grass (`addTallMeadow` in `src/cover.ts`). ~1–2 fps. Shots: `.playwright-mcp/b2/`.
     Still open: deer, wet-rock glints.
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
7. **Procedural rocks with scanned textures** for outcrops, slabs and standing stones: sharp fracture-face
   geometry plus triplanar Poly Haven/ambientCG rock textures (the scans alone repeat after ~17 shapes).
   Through Blender MCP when it's connected.
8. (Done, see below: two-cascade sun shadows.) Possible follow-up: three 0.187's `SunLight` addon (native CSM in
   the WebGL renderer) if more cascades are ever needed; it would mean porting the volumetrics' shadow lookups.
9. **Temporal anti-aliasing**: landed as an opt-in (Display → "temporal AA", `src/taa.ts`): Halton jitter,
   depth reprojection, variance clipping, Catmull-Rom history and a light sharpen; it also averages away the
   volumetric and AO noise. Static views are clean; grass swaying in the wind still softens a little because only
   camera motion is reprojected. Next: per-vertex wind velocity from the grass/fern shaders into a motion buffer,
   then turn it on by default.
10. **Volumetric clouds**. Cloud shadows landed: the sky's clouds are anchored to the world (layer at
    `CLOUD_HEIGHT` 900 m) and the haze pass casts the same field down the sun ray onto land and sea ("cloud
    shadows" slider). Still open: raymarched volumetric cloud shapes.
11. Small: grass blade textures. (Done: calmer fern greens, the eye opening up under a canopy, caustics and
   textured shore foam with the water.)

## Ideas for a gorgeous, rich land (suggested to the user, not yet prioritized)

- Color: wildflower meadows in drifts of purple heather, pink fireweed, yellow buttercups; autumn-tinted birches and
  rowans with red berries among the greens; lichen-orange and moss-green rocks.
- Light: god rays from clouds over the sea; pink-lit cloud wisps at dusk; aurora on clear nights; moonlit
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
- Forest light beams are subtle by default; the "volumetric light" slider strengthens them.
- Nights are very dark without the torch, by design.

## Done

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
