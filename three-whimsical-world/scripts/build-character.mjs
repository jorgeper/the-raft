// Builds the playable Viking for the web from the Blender export and Quaternius' Universal Animation Library
// (both CC0). Textures become WebP, and the animation library is cut down to the clips the game plays.
// Usage: node scripts/build-character.mjs <viking_raw.glb> <UAL1_Standard.glb>
// Output: public/models/viking.glb (skinned character) and public/models/viking-anims.glb (clips only).
// See docs/CHARACTER.md for how viking_raw.glb is assembled in Blender.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, resample } from '@gltf-transform/functions';
import sharp from 'sharp';

const [rawPath, animPath] = process.argv.slice(2);
if (!rawPath || !animPath) throw new Error('usage: node scripts/build-character.mjs <viking_raw.glb> <UAL1_Standard.glb>');
const ROOT = new URL('..', import.meta.url).pathname;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Clips the character controller uses (see src/character.ts). */
export const CLIPS = ['Idle_Loop', 'Idle_Torch_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land'];

// Character: WebP textures, deduplicated.
const char = await io.read(rawPath);
await char.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 }));
await io.write(`${ROOT}public/models/viking.glb`, char);

// Animations: drop the mannequin mesh and unused clips. Only the pelvis keeps translation (height bob, jumps);
// other bones' translations are the mannequin's proportions and would stretch our character.
const anims = await io.read(animPath);
const root = anims.getRoot();
for (const a of root.listAnimations()) {
  if (!CLIPS.includes(a.getName())) {
    // Samplers outlive their animation and would keep its keyframe data alive.
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
    continue;
  }
  for (const ch of a.listChannels()) {
    const node = ch.getTargetNode();
    if (ch.getTargetPath() === 'translation' && node?.getName() !== 'pelvis') {
      ch.getSampler()?.dispose();
      ch.dispose();
    } else if (ch.getTargetPath() === 'scale') {
      ch.getSampler()?.dispose();
      ch.dispose();
    }
  }
}
for (const n of root.listNodes()) n.setMesh(null).setSkin(null);
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
await anims.transform(resample(), prune({ keepLeaves: true }), dedup());
await io.write(`${ROOT}public/models/viking-anims.glb`, anims);
console.log('clips:', anims.getRoot().listAnimations().map((a) => `${a.getName()} ${a.listChannels().length}ch`).join(', '));
