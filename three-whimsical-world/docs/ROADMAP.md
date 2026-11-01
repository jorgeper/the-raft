# Roadmap

Ranked by expected realism gained. Move items to "Done" with the commit hash when finished.

## Next

1. **Procedural rocks with scanned textures** for outcrops, slabs and standing stones: sharp fracture-face
   geometry plus triplanar Poly Haven/ambientCG rock textures (the scans alone repeat after ~17 shapes).
   Through Blender MCP when it's connected.
2. **Textured terrain**: splat scanned ground textures (grass soil, dirt, sand, forest floor, rock) by slope and
   biome, triplanar on steep faces. Today the ground is vertex colors.
3. **Water reflects the land**: planar reflection of terrain, trees and islands; refraction in the shallows.
4. **Cascaded shadow maps** (three's CSM addon): sharp near shadows and shadows to the horizon. One 160 m map now.
5. **Temporal anti-aliasing**: grass and leaves shimmer in motion.
6. **Volumetric clouds** with cloud shadows on the ground.
7. Small: ferns read too neon next to the scanned rocks; grass blade textures, auto-exposure entering forests,
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
