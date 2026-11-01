# Roadmap

In priority order: items 1–4 are the user's requests for the next sessions, the rest ranked by realism gained. Move items to "Done" with the commit hash when finished.

## Next

1. **Valheim look pass**: match the user's reference shots in `reference/`, not just generic realism.
   - First pass landed: painted sky (`src/sky.ts`), Neutral tone mapping, luminous sun-glowing haze, lime grass,
     golden light. Side-by-side grid: `.playwright-mcp/look/compare2.jpg` (regenerate with `.playwright-mcp/compare.js`).
     Waiting on the user's verdict; next candidates: bigger sun bloom, cloud shapes, bluer shadows.
   - Sky: Valheim's painterly gradients (deep blue zenith → pink/peach near the sun → cyan horizon away from it),
     shifting through the day: rose-gold mornings, warm afternoons, magenta-violet dusk, deep blue nights. Likely a
     custom sky shader (or color grading layered on the physical sky) with per-time-of-day color stops.
   - Strong cyan-shadow / gold-highlight split toning; haze that glows pink-orange toward a low sun.
   - Done when: for each reference image, a matching screenshot (same time of day, similar framing) sits beside it
     and the user agrees the palette reads as Valheim.
2. **Whimsical pass** (user request; examples v1–v6 in `~/Downloads`): Valheim's dreamy moments, with lots of
   volumetric light and fog and rich colors contrasting in the same frame. Analyze the examples, recreate the
   effects, and put them behind one "whimsical" slider in the panel that cranks them all up or down.
   - First pass landed: "✨ whimsy" slider (default 0.6) drives a thicker teal/orange split haze, stronger beams,
     lens-flare ghosts, a soft glow pass, a saturated split-tone grade and drifting motes/fireflies (`src/motes.ts`).
     Next: sun glints on water, falling leaves, pink-lit cloud wisps, user's verdict.
   - Light pass landed: haze darkens in canopy shadow and a broad scattering lobe makes sunbeams between trunks;
     ground fog (amount / height / patchiness controls) pools in hollows; S-curve "depth" and three-way
     "color richness" grade (cyan shade, rosy mids, gold light). Side-on beams are still faint: try a dedicated
     beam pass at half resolution with more steps, and denser canopy shadow casters.
3. **Realistic water** (user request: more translucent, especially where it meets the ground):
   - Shallows you can see into: refraction of the seabed and riverbed through the surface, depth-tinted
     absorption (clear turquoise at the edge, deep blue offshore), sand and pebbles visible near the shore.
   - Soft shorelines: depth-faded edges instead of a hard line, wet darkening on the sand, foam lapping in and out.
   - Caustics shimmering on the shallow bottom; planar reflection of terrain, trees and islands.
4. **Beauty pass: rich, lush forests and meadows** ("throw everything at it"). Candidates, pick by impact:
   - Undergrowth variety: berry bushes (raspberry, blueberry), thistles, mushrooms, dandelions and clover, tall
     grass tufts, reeds by rivers, fallen leaves and needle litter, moss carpets on forest floors.
   - Atmosphere: morning mist pooling in hollows and over rivers, drifting dust and pollen motes in sunbeams,
     fireflies at dusk, falling leaves.
   - Life: butterflies over flower drifts, birds circling, a deer or two at forest edges.
   - Light: richer dappled light under canopies, sun glints on wet rocks after rain.
   - Done when: walking from beach through meadow into forest at three times of day looks dense and alive in
     screenshots, compared against the references, at a playable frame rate.
5. **Procedural rocks with scanned textures** for outcrops, slabs and standing stones: sharp fracture-face
   geometry plus triplanar Poly Haven/ambientCG rock textures (the scans alone repeat after ~17 shapes).
   Through Blender MCP when it's connected.
6. **Cascaded shadow maps** (three's CSM addon): sharp near shadows and shadows to the horizon. One 160 m map now.
7. **Temporal anti-aliasing**: grass and leaves shimmer in motion.
8. **Volumetric clouds** with cloud shadows on the ground.
9. Small: ferns read too neon next to the scanned rocks; grass blade textures, auto-exposure entering forests,
   caustics, textured shore foam.

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
