// @ts-check
import { QUALITY_TIERS } from '../quality/tiers.js';

/**
 * Baked cuticle maps (tools/blender/bake_maps.py), shared by every skin/antenna/palp/mandible mesh:
 * albedo (sRGB), tangent-space normal, and orm = AO (R), roughness (G), thickness (B).
 */
export const TEXTURE_MAPS = /** @type {const} */ (['albedo', 'normal', 'orm']);

/**
 * Largest maps shipped. The high tier would afford 4K, but 4K maps alone would exceed the 6 MB
 * first-load budget (S5/T6); a progressive 4K upgrade after the first frame is left to T6.
 */
export const MAX_SHIPPED_TEXTURE_SIZE = 2048;

/**
 * @typedef {typeof TEXTURE_MAPS[number]} TextureMap
 * @typedef {{ size: number, urls: Record<TextureMap, string> }} TextureSet
 */

/**
 * KTX2 files for a quality tier, sized by its `textureSize` (capped to MAX_SHIPPED_TEXTURE_SIZE).
 * @param {import('../quality/tiers.js').TierName} tier
 * @param {string} baseUrl Vite base (import.meta.env.BASE_URL)
 * @returns {TextureSet}
 */
export function textureSetFor(tier, baseUrl) {
  const size = Math.min(QUALITY_TIERS[tier].textureSize, MAX_SHIPPED_TEXTURE_SIZE);
  const urls = /** @type {Record<TextureMap, string>} */ (
    Object.fromEntries(TEXTURE_MAPS.map((map) => [map, `${baseUrl}textures/cuticle-${map}-${size}.ktx2`]))
  );
  return { size, urls };
}

/**
 * Loads the tier's maps through KTX2Loader (Basis Universal transcoder served from public/basis/,
 * so it also resolves under the GitHub Pages subpath).
 * @param {import('three').WebGLRenderer} renderer needed to pick the GPU's compressed format
 * @param {import('../quality/tiers.js').TierName} tier
 * @returns {Promise<Record<TextureMap, import('three').Texture>>}
 */
export async function loadTextureSet(renderer, tier) {
  const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
  const base = import.meta.env.BASE_URL;
  const loader = new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(renderer);
  const { urls } = textureSetFor(tier, base);
  try {
    const textures = await Promise.all(TEXTURE_MAPS.map((map) => loader.loadAsync(urls[map])));
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const texture of textures) texture.anisotropy = anisotropy; // grazing views of the capsule
    return /** @type {Record<TextureMap, import('three').Texture>} */ (Object.fromEntries(TEXTURE_MAPS.map((map, i) => [map, textures[i]])));
  } finally {
    loader.dispose(); // stops the transcoder workers
  }
}
