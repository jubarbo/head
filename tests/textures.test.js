import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { QUALITY_TIERS, TIER_ORDER } from '../src/quality/tiers.js';
import { textureSetFor, TEXTURE_MAPS, MAX_SHIPPED_TEXTURE_SIZE, MAX_SHIPPED_NORMAL_SIZE } from '../src/materials/textureSet.js';

const PUBLIC = new URL('../public/', import.meta.url);
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]; // «KTX 20»\r\n\x1A\n
const TRANSFER_LINEAR = 1;
const TRANSFER_SRGB = 2;
const MODEL_ETC1S = 163; // khr_df_model_e
const MODEL_UASTC = 166;

/** Header fields of a KTX2 file (KTX 2.0 spec, section 3) plus the DFD transfer function. */
function readKtx2(url) {
  const bytes = readFileSync(url);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dfdOffset = view.getUint32(48, true);
  return {
    identifier: [...bytes.subarray(0, 12)],
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
    levels: view.getUint32(40, true),
    // dfdTotalSize (4) + descriptor header (8), then colorModel, colorPrimaries, transferFunction
    model: bytes[dfdOffset + 4 + 8],
    transfer: bytes[dfdOffset + 4 + 8 + 2],
  };
}

/** Files of a tier, resolved inside public/ (the URLs are relative to the Vite base). */
const sizeOf = (map, size) => (map === 'normal' ? Math.min(size, MAX_SHIPPED_NORMAL_SIZE) : size);
const filesOf = (tier) => Object.fromEntries(TEXTURE_MAPS.map((map) => [map, new URL(textureSetFor(tier, '').urls[map], PUBLIC)]));

describe('texture set per quality tier', () => {
  it('uses the tier texture size, capped to the shipped maps, and relative URLs under the Vite base', () => {
    for (const tier of TIER_ORDER) {
      const set = textureSetFor(tier, '/mantis/');
      expect(set.size).toBe(Math.min(QUALITY_TIERS[tier].textureSize, MAX_SHIPPED_TEXTURE_SIZE));
      for (const map of TEXTURE_MAPS) expect(set.urls[map]).toBe(`/mantis/textures/cuticle-${map}-${sizeOf(map, set.size)}.ktx2`);
    }
  });

  it('never ships 4K maps to the low tier', () => {
    expect(textureSetFor('low', '').size).toBeLessThanOrEqual(1024);
  });

  it('gives the high tier the largest shipped maps (4K is held back by the 6 MB first-load budget)', () => {
    expect(MAX_SHIPPED_TEXTURE_SIZE).toBe(2048);
    expect(textureSetFor('high', '').size).toBe(2048);
    expect(textureSetFor('medium', '').size).toBe(2048);
  });

  // T8d: UASTC costs about 4x ETC1S, so the normal map trades resolution for block-free relief.
  it.each(TIER_ORDER)('serves the %s tier the 1024 normal map', (tier) => {
    expect(textureSetFor(tier, '').urls.normal).toBe('textures/cuticle-normal-1024.ktx2');
  });
});

describe('baked cuticle textures (T3)', () => {
  it.each(TIER_ORDER)('publishes KTX2 maps at the %s tier size, with mipmaps', (tier) => {
    const { size } = textureSetFor(tier, '');
    for (const [map, url] of Object.entries(filesOf(tier))) {
      expect(existsSync(url), `${map} ${size}`).toBe(true);
      const header = readKtx2(url);
      expect(header.identifier).toEqual(KTX2_IDENTIFIER);
      expect([header.width, header.height]).toEqual([sizeOf(map, size), sizeOf(map, size)]);
      expect(header.levels).toBeGreaterThan(1);
    }
  });

  it('stores albedo as sRGB and the data maps (normal, AO/roughness/thickness) as linear', () => {
    const files = filesOf('medium');
    expect(readKtx2(files.albedo).transfer).toBe(TRANSFER_SRGB);
    expect(readKtx2(files.normal).transfer).toBe(TRANSFER_LINEAR);
    expect(readKtx2(files.orm).transfer).toBe(TRANSFER_LINEAR);
  });

  // T8d: ETC1S blocks read as pixels on the skin relief (S10); they come from the normal map.
  it.each(TIER_ORDER)('encodes the %s tier normal map as UASTC, and keeps albedo and ORM as ETC1S', (tier) => {
    const files = filesOf(tier);
    expect(readKtx2(files.normal).model).toBe(MODEL_UASTC);
    expect(readKtx2(files.albedo).model).toBe(MODEL_ETC1S);
    expect(readKtx2(files.orm).model).toBe(MODEL_ETC1S);
  });

  it("uses three's own Basis transcoder (Vite emits it next to the chunk, so it follows the Pages subpath) and ships no second copy", () => {
    const ktx2Loader = readFileSync(new URL('../node_modules/three/examples/jsm/loaders/KTX2Loader.js', import.meta.url), 'utf8');
    expect(ktx2Loader).toContain("new URL( '../libs/basis/basis_transcoder.wasm', import.meta.url )");
    expect(readFileSync(new URL('../src/materials/textureSet.js', import.meta.url), 'utf8')).not.toContain('setTranscoderPath');
    expect(existsSync(new URL('basis', PUBLIC))).toBe(false);
  });

  it('keeps the first load of every tier (model + HDRI + maps) under 6 MB', () => {
    const fixed = statSync(new URL('models/mantis-head.glb', PUBLIC)).size + statSync(new URL('hdri/studio_small_09_1k.hdr', PUBLIC)).size;
    for (const tier of TIER_ORDER) {
      const maps = Object.values(filesOf(tier)).reduce((sum, url) => sum + statSync(url).size, 0);
      expect(fixed + maps, tier).toBeLessThan(6 * 1024 * 1024);
    }
  });
});
