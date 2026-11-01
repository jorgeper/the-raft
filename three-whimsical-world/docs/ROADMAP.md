# Roadmap

In priority order: user requests first, then realism gained. Move items to "Done" with the commit hash when finished.

## Next

1. **Playable character with first/third-person views** (requested for the next session).
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
2. **Procedural rocks with scanned textures** for outcrops, slabs and standing stones: sharp fracture-face
   geometry plus triplanar Poly Haven/ambientCG rock textures (the scans alone repeat after ~17 shapes).
   Through Blender MCP when it's connected.
3. **Textured terrain**: splat scanned ground textures (grass soil, dirt, sand, forest floor, rock) by slope and
   biome, triplanar on steep faces. Today the ground is vertex colors.
4. **Water reflects the land**: planar reflection of terrain, trees and islands; refraction in the shallows.
5. **Cascaded shadow maps** (three's CSM addon): sharp near shadows and shadows to the horizon. One 160 m map now.
6. **Temporal anti-aliasing**: grass and leaves shimmer in motion.
7. **Volumetric clouds** with cloud shadows on the ground.
8. Small: ferns read too neon next to the scanned rocks; grass blade textures, auto-exposure entering forests,
   caustics, textured shore foam.

## Later

- **Render the user's Valheim base** from their world file (`<World>.fwl` = name + seed, `<World>.db` = every
  built piece and terrain edit). Copy them in with the game closed. Building pieces need our own models
  (Blender MCP, or Tripo for props); Valheim's assets are copyrighted.
- Tripo-generated props (huts, longship, rune stones) through Blender MCP Premium or manual GLB downloads.
- Persist panel settings across reloads (only on request).

## Known issues

- ~35 fps deep in forest at night with the torch on (1280×720, headless). Lower render scale if needed.
- Forest light beams are subtle by default; the "volumetric light" slider strengthens them.
- Nights are very dark without the torch, by design.

## Done

- Scanned rocks: 17 Poly Haven shapes (`npm run assets`), two detail levels, moss slider. `boulder_01` was left
  out because it won't simplify below ~54k triangles.
- `33ddfd9` Terrain, sky, sea. `56dbf71` Grass, trees, LODs. `6141e7c` Post-processing, walking.
- `3911bc6` Grass clumps, tree crowns, AO, far land, rocks. `3a6fea0` Tree impostors, sea, beach.
- `a9b7fac` World generator panel, forest biome, ground cover, time of day.
- `d232660` Torch, volumetric sunlight, ferns. `90d31e7` Minimap, realistic fire, variety, display settings.
