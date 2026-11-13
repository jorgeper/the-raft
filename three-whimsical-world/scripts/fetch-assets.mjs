// Downloads CC0 photoscanned rocks from Poly Haven and builds two detail levels of each for the scene, plus
// the CC0 ground textures the terrain splats (public/assets/ground/) and scanned plants (public/assets/plants/).
// Usage: npm run assets            (skips assets already built)
//        npm run assets -- --force (rebuilds the models; downloads stay cached)
//
// Raw downloads go to .cache/polyhaven/, built models to public/assets/rocks/ (both gitignored).

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache/polyhaven');
const OUT = join(ROOT, 'public/assets/rocks');
const RESOLUTION = '1k';

/** Poly Haven model ids. Sets contain several rocks; the scene splits them into separate variants. */
// boulder_01 was tried and left out: its scan won't simplify below ~54k triangles.
const ROCKS = ['rock_07', 'rock_09', 'rock_moss_set_01', 'rock_moss_set_02', 'rock_face_01', 'stone_01'];

/** Target triangles per detail level, for the whole file (sets share it across their rocks). */
/** The far level is geometry only: the scene reuses the near level's materials for it. */
const LODS = [
  { name: 'lod0', triangles: 6000, textures: true },
  { name: 'lod1', triangles: 900, textures: false },
];

const force = process.argv.includes('--force');
const exists = (p) => access(p).then(() => true, () => false);

async function download(url, path) {
  if (await exists(path)) return;
  const res = await fetch(url, { headers: { 'User-Agent': '3d-tests asset fetcher' } });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

async function fetchModel(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': '3d-tests asset fetcher' } });
  if (!res.ok) throw new Error(`${res.status} listing files for ${id}`);
  const entry = (await res.json()).gltf?.[RESOLUTION]?.gltf;
  if (!entry) throw new Error(`${id} has no ${RESOLUTION} glTF`);
  const dir = join(CACHE, id);
  const gltfPath = join(dir, `${id}.gltf`);
  await download(entry.url, gltfPath);
  for (const [relative, file] of Object.entries(entry.include ?? {})) {
    // Keep downloads inside the asset's own folder.
    const target = join(dir, relative);
    if (!target.startsWith(dir)) throw new Error(`refusing path outside cache: ${relative}`);
    await download(file.url, target);
  }
  return gltfPath;
}

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return tris;
}

async function main() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await mkdir(OUT, { recursive: true });
  const manifest = [];

  for (const id of ROCKS) {
    const outputs = LODS.map((lod) => join(OUT, `${id}.${lod.name}.glb`));
    if (!force && (await Promise.all(outputs.map(exists))).every(Boolean)) {
      console.log(`✓ ${id} (already built)`);
      manifest.push(id);
      continue;
    }
    process.stdout.write(`↓ ${id} … `);
    const gltfPath = await fetchModel(id);
    const parts = [];
    for (const [i, lod] of LODS.entries()) {
      const doc = await io.read(gltfPath);
      const before = countTriangles(doc);
      const ratio = Math.min(1, lod.triangles / before);
      if (!lod.textures) for (const texture of doc.getRoot().listTextures()) texture.dispose();
      await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.5 }), prune());
      await io.write(outputs[i], doc);
      parts.push(`${lod.name} ${Math.round(before)}→${Math.round(countTriangles(doc))} tris`);
    }
    console.log(parts.join(', '));
    manifest.push(id);
  }

  await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ rocks: manifest, lods: LODS.map((l) => l.name) }, null, 2));
  console.log(`Wrote ${manifest.length} rocks to ${OUT}`);
  await fetchGround();
  await buildPlants(io);
}

/** Scanned plants: [Poly Haven id, target triangles per variant]. */
const PLANTS = [['fern_02', 900]];
const PLANTS_OUT = join(ROOT, 'public/assets/plants');

/**
 * Plants come as alpha-masked cards whose glTF points at a JPEG diffuse without alpha; the cutout is a separate
 * Alpha map. Merge the two into one WebP with alpha, simplify each variant, and drop the unused AO/roughness map.
 */
async function buildPlants(io) {
  const sharp = (await import('sharp')).default;
  await mkdir(PLANTS_OUT, { recursive: true });
  for (const [id, triangles] of PLANTS) {
    const out = join(PLANTS_OUT, `${id}.glb`);
    if (!force && (await exists(out))) {
      console.log(`✓ ${id} (already built)`);
      continue;
    }
    const gltfPath = await fetchModel(id);
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': '3d-tests asset fetcher' } })).json();
    const alphaPath = join(CACHE, id, `${id}_alpha.jpg`);
    await download(files.Alpha[RESOLUTION].jpg.url, alphaPath);

    const doc = await io.read(gltfPath);
    const material = doc.getRoot().listMaterials()[0];
    const base = material.getBaseColorTexture();
    const alpha = await sharp(alphaPath).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    const rgba = await sharp(Buffer.from(base.getImage()))
      .resize(alpha.info.width, alpha.info.height)
      // (No removeAlpha here: sharp applies it after joinChannel, which would strip the new alpha again.)
      .joinChannel(alpha.data, { raw: { width: alpha.info.width, height: alpha.info.height, channels: 1 } })
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer();
    base.setImage(rgba).setMimeType('image/webp');
    material.getMetallicRoughnessTexture()?.dispose();
    const normal = material.getNormalTexture();
    if (normal) normal.setImage(await sharp(Buffer.from(normal.getImage())).webp({ quality: 85 }).toBuffer()).setMimeType('image/webp');

    const before = countTriangles(doc);
    const meshes = doc.getRoot().listMeshes().length;
    await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, (triangles * meshes) / before), error: 0.02 }), prune());
    doc.createExtension(EXTTextureWebP).setRequired(true);
    await io.write(out, doc);
    console.log(`✓ ${id} ${Math.round(before)}→${Math.round(countTriangles(doc))} tris (${meshes} variants)`);
  }
}

/** Ground texture layers for the terrain, in the order src/ground.ts samples them. */
const GROUND = ['leafy_grass', 'forrest_ground_01', 'brown_mud_leaves_01', 'rock_face_03', 'coast_sand_01'];
const GROUND_OUT = join(ROOT, 'public/assets/ground');

async function fetchGround() {
  await mkdir(GROUND_OUT, { recursive: true });
  for (const id of GROUND) {
    const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': '3d-tests asset fetcher' } });
    if (!res.ok) throw new Error(`${res.status} listing files for ${id}`);
    const files = await res.json();
    for (const [map, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor']]) {
      const url = files[map]?.[RESOLUTION]?.jpg?.url;
      if (!url) throw new Error(`${id} has no ${RESOLUTION} ${map} jpg`);
      const path = join(GROUND_OUT, `${id}_${suffix}.jpg`);
      if (force || !(await exists(path))) await download(url, path);
    }
    console.log(`✓ ground ${id}`);
  }
  await writeFile(join(GROUND_OUT, 'manifest.json'), JSON.stringify({ layers: GROUND }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
