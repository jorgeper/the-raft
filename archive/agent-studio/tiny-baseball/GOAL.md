# Launching the Tiny Baseball v1 build with /goal

Run from `tiny-baseball/`.

```
/goal Implement SPEC.md in full (cozy retro three.js arcade baseball; engine pure and three-free, seeded RNG, local 1P-vs-CPU and 2P shared-keyboard modes; online play explicitly out of scope). Done when: 'npm run validate' exits 0 with its complete output — unit tests U1–U6, e2e E1–E5, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run build' exits 0 with the dist/ total size printed (≤ 2 MB), AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND 'git diff --stat SPEC.md' is empty, AND a screenshot of live gameplay (not the title screen) is captured via Playwright showing the diamond, at least 6 players, the crowd-filled stands, clouds in a blue sky, and the scoreboard HUD, AND README.md documents controls for both modes and ARCHITECTURE.md documents the engine/render split and the __game test hook. Constraints: SPEC.md and this condition must not be modified; tests may not be weakened, stubbed, or deleted; no remote assets, fonts, or CDN imports — all geometry procedural and all audio WebAudio-synthesized; the engine directory must never import three.js. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work.
```

After it goes green, manual checks: start a 2P game and have one person pitch
(1/2/3 + arrows + Enter) while the other times Space — a perfect swing should
occasionally rocket one over the wall with a big cheer, confetti, and a
traveling crowd wave; check the chunky-pixel look scales cleanly when you
resize the window; toggle M and reload to confirm mute sticks.
