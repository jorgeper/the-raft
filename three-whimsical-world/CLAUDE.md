# Meadows: a Valheim-like world in Three.js

An experiment in how far Claude Code can push realistic real-time 3D. The target is Valheim's look (meadows,
Black Forest, sea, cyan/gold light) but more realistic. Vite + TypeScript + vanilla Three.js (WebGL2, custom GLSL).

Plans, open problems and ideas: read `docs/ROADMAP.md` when picking the next task or when the user asks
what's left.

## Verify every visual change by looking

Visual work is done when a screenshot shows it, not when it type-checks. The loop:

1. `npx tsc --noEmit -p .`, then reload `http://localhost:5173` in the Playwright browser (start `npx vite` in the
   background if it isn't running).
2. Frame the shot with URL params: `?cam=x,heightAboveGround,z,targetX,targetY,targetZ&time=hours`
   (a height above walking eye level starts in fly mode).
3. Screenshot into `.playwright-mcp/` (Playwright can only write inside the project) and look at it.
4. Compare against the references in `reference/` (Valheim meadow and forest shots).
5. Measure fps with a `requestAnimationFrame` counter for 2 s; meadows should hold 60 at 1280×720.

`window.__app` exposes the camera, world, settings, post-processing uniforms, `display`/`applyDisplay`,
`movement`, `torch` and `regenerate()` so shots and A/B toggles can be scripted with `browser_evaluate`.
When something looks wrong, bisect by switching effects off one at a time through `__app.post` (bloom,
volumetric, shafts, fog, AO) before changing code.

## Gotchas learned the hard way

- `THREE.MathUtils.smoothstep(x, min, max)` takes the value first; the local `smoothstep(a, b, x)` in
  `worldgen.ts` takes it last. Mixing them up inverted the forest haze once.
- The sky renders at depth exactly 1.0; distant land reaches 0.99998. Test sky with `depth >= 1.0`, never an epsilon.
- The haze pass caps HDR at 6.6 before bloom (threshold 6). Raising the cap or bloom strength veils the
  frame whenever the sun is in view.
- A `sampler2DShadow` can't be bound before the shadow map exists: the volumetric code is behind the
  `HAS_SHADOW` define, set once the sun's shadow map is created.
- Hot reload can interrupt Playwright navigation (`ERR_ABORTED`); just navigate again.
- lil-gui 0.21 uses different DOM class names than older docs show; drive settings through `__app` instead.

## Assets and references

- `reference/` holds the user's Valheim screenshots (copyrighted, gitignored). Use them for comparison only.
- Third-party assets must allow redistribution on the web: CC0 first (Poly Haven, ambientCG). Downloaded
  assets live under `public/assets/` (gitignored) and are fetched by `scripts/fetch-assets.mjs`, so the repo
  stays small and `npm run assets` restores them.
- Blender MCP ("MCP for Blender" add-on) is connected for this project: use it to author or clean up meshes
  and export glTF. Its Tripo integration needs the paid Premium tier.
