import * as THREE from 'three';

/**
 * Photoscanned CC0 ground textures (Poly Haven, fetched by `npm run assets` into public/assets/ground/), packed
 * into texture arrays the terrain splats by biome and slope. Layer order matches scripts/fetch-assets.mjs:
 * 0 meadow soil and leaves, 1 forest floor, 2 bare earth, 3 rock, 4 sand.
 *
 * The scans add detail rather than color: the terrain divides each sample by the texture's mean color and
 * multiplies the result onto its art-directed vertex colors, so the palette stays Valheim's.
 */
export const GROUND_LAYERS = 5;
const SIZE = 1024;

export const groundUniforms = {
  tGroundDiff: { value: null as THREE.DataArrayTexture | null },
  tGroundNorm: { value: null as THREE.DataArrayTexture | null },
  /** Mean linear color of each diffuse layer. */
  uGroundMean: { value: Array.from({ length: GROUND_LAYERS }, () => new THREE.Vector3(1, 1, 1)) },
  /** How strongly the scans show (0 = flat vertex colors). */
  uGroundDetail: { value: 1 },
};

async function pixels(url: string): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function arrayTexture(data: Uint8Array, srgb: boolean) {
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, GROUND_LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Loads the layers into groundUniforms; resolves false (terrain keeps flat colors) when they're missing. */
export async function loadGroundTextures(base = `${import.meta.env.BASE_URL}assets/ground/`): Promise<boolean> {
  try {
    const manifest = await (await fetch(base + 'manifest.json')).json();
    const layers: string[] = manifest.layers;
    if (layers.length !== GROUND_LAYERS) throw new Error(`expected ${GROUND_LAYERS} ground layers`);
    const layerBytes = SIZE * SIZE * 4;
    const diff = new Uint8Array(layerBytes * GROUND_LAYERS);
    const norm = new Uint8Array(layerBytes * GROUND_LAYERS);
    await Promise.all(
      layers.map(async (id, i) => {
        const [d, n] = await Promise.all([pixels(`${base}${id}_diff.jpg`), pixels(`${base}${id}_nor.jpg`)]);
        diff.set(d, i * layerBytes);
        norm.set(n, i * layerBytes);
        // Mean linear color from a sparse sample.
        const mean = groundUniforms.uGroundMean.value[i].set(0, 0, 0);
        let count = 0;
        for (let p = 0; p < d.length; p += 4 * 97) {
          mean.x += toLinear(d[p] / 255);
          mean.y += toLinear(d[p + 1] / 255);
          mean.z += toLinear(d[p + 2] / 255);
          count++;
        }
        mean.divideScalar(count);
      }),
    );
    groundUniforms.tGroundDiff.value = arrayTexture(diff, true);
    groundUniforms.tGroundNorm.value = arrayTexture(norm, false);
    return true;
  } catch (err) {
    console.warn('Ground textures not loaded (run `npm run assets`):', err);
    return false;
  }
}
