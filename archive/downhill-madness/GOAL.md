# Goal statement

Paste this as the prompt to build the game:

---

Build **Downhill Madness** exactly as specified in `spec.md` in this directory. Read the entire spec first; it is the source of truth for mechanics, obstacle catalog, art direction, tone (cozy + hilarious), architecture, and tuning values.

Work in milestones, and after each one run the game (`npm run dev`) and verify it visually before moving on:

1. **Foundation** — Vite scaffold, renderer, fixed-timestep loop, chase camera over a placeholder trail. Blue sky, sunlight, and tone mapping in from day one.
2. **World** — chunk-recycled winding trail, terrain, instanced organic vegetation with wind-sway wobble, clouds, phase-based light blending. This milestone is done when a static screenshot already looks like a cozy sunny trail you'd want to hike.
3. **Player** — continuous steering, jump, the spring-driven floppy run animation (spec §7.1 — he must look funny just running), speed ramp, camera FOV/shake coupling.
4. **Obstacles** — registry + pooled spawner with the fairness verifier, then implement all 24 catalog obstacles phase by phase. Solid = crash with the emergent physics ragdoll (spec §7.1) + slow-mo; soft = stumble.
5. **Scoring & UI** — distance + all style events (near-miss, threading, air, spins, scatter, combo), HUD popups, start/end screens, localStorage best, instant retry.
6. **Polish** — god rays, butterflies/pollen/drifting leaves, dust puffs, WebAudio slapstick sounds, ragdoll comedy tuning (hat and backpack fly off, scattered sheep), touch controls.
7. **Tuning & tests** — Vitest suite from spec §11, then play at least 5 full runs and tune until: survivable for 15 s, brutally hard past 45 s, median death 350–800 m — and crash 5 times on purpose to confirm every wipeout looks different and makes you laugh.

Definition of done: every item in the spec's acceptance checklist (§11) passes, `npm test` is green, no console errors, 60 fps on desktop, and the game is genuinely charming — if a random screenshot doesn't look like a poster of a sun-drenched cozy PNW trail, or the runner doesn't make you smile, keep polishing until it does.
