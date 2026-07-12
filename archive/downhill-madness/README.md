# Downhill Madness 🏃🌲

He tripped at the trailhead. He can't stop. Good luck.

A cozy, hilarious Three.js endless-downhill runner set on a sun-drenched
Pacific Northwest trail. Steer, jump, and spin through 24 escalating
obstacles — roots, sheep, dog-leash tripwires, falling trees, mountain
bikers, rolling logs, ranger roadblocks — until physics wins. Every crash
is an emergent Verlet-ragdoll spectacle.

Built to `spec.md` (the design source of truth) via `GOAL.md`.

## Play

```bash
npm install
npm run dev      # open the printed localhost URL
```

- **A/D** or **←/→** steer · **Space/W/↑** jump · **S/↓/T** spin (in air)
- Touch: hold left/right half to steer · swipe ↑ to jump · tap with a second finger in air to spin
- **R** retry · **M** mute · **Esc** pause

Score = distance + style (near-misses, threading, air time, stacking spins,
scattering critters, 3-event combos ×1.5). Best score persists locally.

## Develop

```bash
npm test         # Vitest: speed curve, spawn tables, fairness verifier,
                 # scoring/combos, AABB, seeded RNG, style detection
npm run build    # production bundle
```

Dev/test URL params: `?seed=N` (deterministic run), `?start=M` (begin at M
meters), `?ghost=1` (no collisions — for inspecting late phases).

Everything is procedural — no downloaded models, textures, sounds, or fonts.
Audio is synthesized WebAudio; geometry is generated at load.

## Layout

Per `spec.md` §10, with one deliberate deviation: obstacle defs are grouped
per phase (`src/obstacles/types/phase1..4.js`), one exported def per
obstacle, rather than one file each — adding an obstacle still touches one
file plus the spawn table (`src/obstacles/tables.js`).
