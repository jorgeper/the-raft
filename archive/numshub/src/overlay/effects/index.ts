// The effect registry (SPEC6 FR-A2): 15 built-ins. Adding an effect =
// one module + one entry here. `classic-bars` is the default.

import type { EffectDef } from "./types";
import { createClassicBars } from "./classicBars";
import { createMirrorWave } from "./mirrorWave";
import { createOscilloscope } from "./oscilloscope";
import { createSpectrumBlocks } from "./spectrumBlocks";
import { createParticleFountain } from "./particleFountain";
import { createPulseOrb } from "./pulseOrb";
import { createRadialRings } from "./radialRings";
import { createCometTrail } from "./cometTrail";
import { createRipplePond } from "./ripplePond";
import { createStarfield } from "./starfield";
import { createVuNeedle } from "./vuNeedle";
import { createDnaHelix } from "./dnaHelix";
import { createFireflies } from "./fireflies";
import { createGlitchBars } from "./glitchBars";
import { createAurora } from "./aurora";

export const DEFAULT_EFFECT = "classic-bars";

export const EFFECTS: EffectDef[] = [
  { id: "classic-bars", name: "Classic Bars", create: createClassicBars },
  { id: "mirror-wave", name: "Mirror Wave", create: createMirrorWave },
  { id: "oscilloscope", name: "Oscilloscope", create: createOscilloscope },
  { id: "spectrum-blocks", name: "Spectrum Blocks", create: createSpectrumBlocks },
  { id: "particle-fountain", name: "Particle Fountain", create: createParticleFountain },
  { id: "pulse-orb", name: "Pulse Orb", create: createPulseOrb },
  { id: "radial-rings", name: "Radial Rings", create: createRadialRings },
  { id: "comet-trail", name: "Comet Trail", create: createCometTrail },
  { id: "ripple-pond", name: "Ripple Pond", create: createRipplePond },
  { id: "starfield", name: "Starfield", create: createStarfield },
  { id: "vu-needle", name: "VU Needle", create: createVuNeedle },
  { id: "dna-helix", name: "DNA Helix", create: createDnaHelix },
  { id: "fireflies", name: "Fireflies", create: createFireflies },
  { id: "glitch-bars", name: "Glitch Bars", create: createGlitchBars },
  { id: "aurora", name: "Aurora", create: createAurora },
];

/** Unknown ids fall back to the default — settings resilience. */
export function getEffect(id: string): EffectDef {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS.find((e) => e.id === DEFAULT_EFFECT)!;
}
