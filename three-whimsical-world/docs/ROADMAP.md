# Roadmap

In priority order: items 1–3 are the user's requests for the next sessions, the rest ranked by realism gained. Move items to "Done" with the commit hash when finished.

## Next

1. **Playable character with first/third-person views**.
   - A Viking-looking rigged character in Valheim's spirit: beard, tunic, cloak, boots. Valheim's own models are
     copyrighted, so source a lookalike: a CC0/CC-BY rigged character (Sketchfab, Quaternius), or generate one
     (Tripo or Rodin, auto-rigged) and refine it through Blender MCP. Present the options to the user and let them
     pick before downloading or generating.
   - Animations: idle, walk, run, jump (take-off, airborne, landing). Mixamo-style clips retargeted in Blender work
     if the license allows shipping them in a web app; confirm before using.
   - Load as glTF with `AnimationMixer`, crossfading clips by ground speed and vertical velocity from the existing
     walk/run/jump movement code. Orient the body to the movement direction.
   - **V** toggles first/third person (also a Controls panel option). Third person: over-the-shoulder camera on a
     smoothed spring arm that never dips below the terrain; mouse orbits it. First person keeps today's camera
     and hides the body (or shows only arms).
   - In third person the torch moves to the character's hand bone, and its light and embers follow it.
   - Done when: both views work while walking, running and jumping on slopes, verified with screenshots in a
     meadow and a forest, and frame rate is checked with the character on screen.
2. **Valheim look pass**: match the user's reference shots in `reference/`, not just generic realism.
   - First pass landed: painted sky (`src/sky.ts`), Neutral tone mapping, luminous sun-glowing haze, lime grass,
     golden light. Side-by-side grid: `.playwright-mcp/look/compare2.jpg` (regenerate with `.playwright-mcp/compare.js`).
     Waiting on the user's verdict; next candidates: bigger sun bloom, cloud shapes, bluer shadows.
   - Sky: Valheim's painterly gradients (deep blue zenith → pink/peach near the sun → cyan horizon away from it),
     shifting through the day: rose-gold mornings, warm afternoons, magenta-violet dusk, deep blue nights. Likely a
     custom sky shader (or color grading layered on the physical sky) with per-time-of-day color stops.
   - Strong cyan-shadow / gold-highlight split toning; haze that glows pink-orange toward a low sun.
   - Done when: for each reference image, a matching screenshot (same time of day, similar framing) sits beside it
     and the user agrees the palette reads as Valheim.
3. **Beauty pass: rich, lush forests and meadows** ("throw everything at it"). Candidates, pick by impact:
   - Undergrowth variety: berry bushes (raspberry, blueberry), thistles, mushrooms, dandelions and clover, tall
     grass tufts, reeds by rivers, fallen leaves and needle litter, moss carpets on forest floors.
   - Atmosphere: morning mist pooling in hollows and over rivers, drifting dust and pollen motes in sunbeams,
     fireflies at dusk, falling leaves.
   - Life: butterflies over flower drifts, birds circling, a deer or two at forest edges.
   - Light: richer dappled light under canopies, sun glints on wet rocks after rain.
   - Done when: walking from beach through meadow into forest at three times of day looks dense and alive in
     screenshots, compared against the references, at a playable frame rate.
4. **Procedural rocks with scanned textures** for outcrops, slabs and standing stones: sharp fracture-face
   geometry plus triplanar Poly Haven/ambientCG rock textures (the scans alone repeat after ~17 shapes).
   Through Blender MCP when it's connected.
5. **Textured terrain**: splat scanned ground textures (grass soil, dirt, sand, forest floor, rock) by slope and
   biome, triplanar on steep faces. Today the ground is vertex colors.
6. **Water reflects the land**: planar reflection of terrain, trees and islands; refraction in the shallows.
7. **Cascaded shadow maps** (three's CSM addon): sharp near shadows and shadows to the horizon. One 160 m map now.
8. **Temporal anti-aliasing**: grass and leaves shimmer in motion.
9. **Volumetric clouds** with cloud shadows on the ground.
10. Small: ferns read too neon next to the scanned rocks; grass blade textures, auto-exposure entering forests,
   caustics, textured shore foam.

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

- Persistent settings: every panel value survives a reload (`src/persist.ts`, `?defaults` skips it); "Reset to
  defaults" restores them and regenerates the world if world settings changed.
- Scanned rocks: 17 Poly Haven shapes (`npm run assets`), two detail levels, moss slider. `boulder_01` was left
  out because it won't simplify below ~54k triangles.
- `33ddfd9` Terrain, sky, sea. `56dbf71` Grass, trees, LODs. `6141e7c` Post-processing, walking.
- `3911bc6` Grass clumps, tree crowns, AO, far land, rocks. `3a6fea0` Tree impostors, sea, beach.
- `a9b7fac` World generator panel, forest biome, ground cover, time of day.
- `d232660` Torch, volumetric sunlight, ferns. `90d31e7` Minimap, realistic fire, variety, display settings.
