# Meadows: a Valheim-like world in Three.js

An experiment in how far Claude Code can push real-time 3D. The user's bar is "amazing": rich, lush and beautiful
first, with Valheim's look (meadows, Black Forest, sea, blue-pink-cyan skies, cyan/gold light) and realism wherever it
helps. Be ambitious: when a pass looks merely fine, keep layering detail and atmosphere. Vite + TypeScript + vanilla Three.js (WebGL2, custom GLSL).

Plans, open problems and ideas: read `docs/ROADMAP.md` when picking the next task or when the user asks
what's left.

## Verify every visual change by looking

Visual work is done when a screenshot shows it, not when it type-checks. The loop:

1. `npx tsc --noEmit -p .`, then reload `http://localhost:5173` in the Playwright browser (start `npx vite` in the
   background if it isn't running).
2. Frame the shot with URL params: `?cam=x,heightAboveGround,z,targetX,targetY,targetZ&time=hours`
   (a height above walking eye level starts in fly mode).
   Panel settings persist in `localStorage`; add `&defaults` so a shot ignores (and doesn't overwrite) them.
3. Screenshot into `.playwright-mcp/` (Playwright can only write inside the project) and look at it.
4. Compare against the references in `reference/` (Valheim meadow and forest shots).
5. Measure fps with a `requestAnimationFrame` counter for 2 s; meadows should hold 60 at 1280×720.

`window.__app` exposes the camera, world, settings, post-processing uniforms, `display`/`applyDisplay`,
`movement`, `torch`, `character` and `regenerate()` so shots and A/B toggles can be scripted with `browser_evaluate`.
The demo film (`src/demo.ts`) can be reviewed shot by shot with `__app.startDemo()` then `__app.demo.seek(seconds)`
(`__app.demo.starts` lists where each shot begins). `npm run film` renders it to a 1080p60 video with its soundscape
(`scripts/film/`: frame-exact offline render on a virtual clock, then a real-time audio pass; output in `recordings/`).
The camera follows `__app.player` (the eye; mouse look and WASD move it): to frame a shot from script, move and
rotate `player`, then call `snapView()`. Third person is the default view; add `&view=first` for scenery shots.
When something looks wrong, bisect by switching effects off one at a time through `__app.post` (bloom,
volumetric, shafts, fog, AO) before changing code.

## Gotchas learned the hard way

- `THREE.MathUtils.smoothstep(x, min, max)` takes the value first; the local `smoothstep(a, b, x)` in
  `worldgen.ts` takes it last. Mixing them up inverted the forest haze once.
- The sky renders at depth exactly 1.0; distant land reaches 0.99998. Test sky with `depth >= 1.0`, never an epsilon.
- Tone mapping is Neutral, not ACES: ACES pulls bright saturated blues and greens toward white. Sky colors are a
  table of stops by sun elevation in `src/sky.ts`; keep them under ~5.5 except the sun disc.
- The haze pass caps HDR at 6.6 before bloom (threshold 6). Raising the cap or bloom strength veils the
  frame whenever the sun is in view.
- A `sampler2DShadow` can't be bound before the shadow map exists: `VolumetricPass` (`src/volumetric.ts`) skips
  its march until the sun's map is there, and the atmosphere pass treats visibility as 1 until then (`uVisOn`).
- A shader that fails to compile draws nothing and the frame still looks plausible (a broken terrain showed the sea
  plane underneath). After any GLSL edit, check the console for `Shader Error`; avoid GLSL ES 3 keywords as names
  (`flat`, `smooth`, `sample`, `patch`, `filter`...).
- Overlays (motes, rain) must depth-test against `post.sceneDepth` (a copy taken before the full-screen passes), not
  the composer target's depth: with the TAA on, the overlay draws into that very target.
- Hot reload can interrupt Playwright navigation (`ERR_ABORTED`); just navigate again.
- lil-gui 0.21 uses different DOM class names than older docs show; drive settings through `__app` instead.
- The scene target's alpha carries wind motion to the TAA (`addWind` in `src/wind.ts`): opaque materials must
  write alpha 1. A new swaying material should go through `addWind`; one that writes its own alpha reads as motion.
- glTF vertex colors can be normalized Uint16: `setXYZ` past 1 wraps to near 0 (the deer's white rumps turned
  blue). Clamp to 1 when brightening them.
- The cliff shell (`src/cliff-worker.ts`) is a half-meter mesh: relief finer than ~1 m, or steps sharper than that,
  alias into combs and moiré. Keep its features broad (the scans' normal map carries the grain), and keep rows on
  level contours so near-horizontal seams don't stair-step across the triangles.
- Demo shots ease their timing, so the camera is not at a key at that key's even share of the shot. A camera that
  must keep pace with something moving (the stampede) needs `linear: true` on its shot.
- In Blender scripts run through MCP, `bpy.ops.wm.read_homefile` leaves the context without an active object (later
  `mode_set` calls fail); delete objects and data blocks instead, as `scripts/blender/rig-deer.py` does.

## Assets and references

- Ground textures (`public/assets/ground/`, Poly Haven CC0) come from `npm run assets` like the rocks; without them
  the terrain falls back to flat vertex colors.
- `reference/` holds the user's Valheim screenshots (copyrighted, gitignored). Use them for comparison only.
- Third-party assets must allow redistribution on the web: CC0 first (Poly Haven, ambientCG). Downloaded
  assets live under `public/assets/` (gitignored) and are fetched by `scripts/fetch-assets.mjs`, so the repo
  stays small and `npm run assets` restores them.
- The Viking (`public/models/`, CC0 Quaternius, committed) is rebuilt as described in `docs/CHARACTER.md`.
- Blender MCP ("MCP for Blender" add-on) is connected for this project: use it to author or clean up meshes
  and export glTF. Its Tripo integration needs the paid Premium tier.
