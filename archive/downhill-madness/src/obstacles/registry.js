import { rootSnarl, smallRock, boulder, mudPuddle, fallenBranch } from './types/phase1.js';
import { sheep, cow, hiker, dogLeash, log, stream } from './types/phase2.js';
import { fallingTree, biker, rockslide, deer, picnic, narrows, logRamp } from './types/phase3.js';
import { rollingLog, beeSwarm, ranger, slalom, chickens, waterfall } from './types/phase4.js';

// All 24 obstacles (spec §6.1). Adding one: write its def, list it here,
// add a row to tables.js.
export const REGISTRY = Object.fromEntries(
  [
    rootSnarl, smallRock, boulder, mudPuddle, fallenBranch,
    sheep, cow, hiker, dogLeash, log, stream,
    fallingTree, biker, rockslide, deer, picnic, narrows, logRamp,
    rollingLog, beeSwarm, ranger, slalom, chickens, waterfall,
  ].map((def) => [def.name, def])
);
