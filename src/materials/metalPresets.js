// @ts-check
import { Color } from 'three';

/**
 * @typedef {'chrome' | 'gold' | 'copper' | 'agedBronze' | 'titanium'} MetalPresetName
 * @typedef {{ label: string, color: Color, roughness: number, patina: number, saturation: number }} MetalPreset
 */

/** Linear base reflectance (F0) of a metal, which is also its PBR base color at metalness 1. */
const f0 = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => new Color().setRGB(r, g, b);

/**
 * Metal finishes for the skin → metal slider (S3). F0 values are the usual measured ones (Hoffman,
 * "Physics and Math of Shading", SIGGRAPH 2015); aged bronze is darkened and grows verdigris in the
 * baked cavities (`patina`). `saturation` pre-grades the tint for AgX, which rolls bright colors off
 * toward white (L15): low-chroma copper needs more than gold; neutral chrome none.
 * @type {Readonly<Record<MetalPresetName, MetalPreset>>}
 */
export const METAL_PRESETS = Object.freeze({
  chrome: { label: 'Chrome', color: f0(0.55, 0.556, 0.554), roughness: 0.08, patina: 0, saturation: 1 },
  gold: { label: 'Gold', color: f0(1.0, 0.766, 0.336), roughness: 0.18, patina: 0, saturation: 1.5 },
  copper: { label: 'Copper', color: f0(0.955, 0.638, 0.538), roughness: 0.24, patina: 0, saturation: 3 },
  agedBronze: { label: 'Aged bronze', color: f0(0.62, 0.45, 0.31), roughness: 0.42, patina: 1, saturation: 1.8 },
  titanium: { label: 'Titanium', color: f0(0.542, 0.497, 0.449), roughness: 0.3, patina: 0, saturation: 1.3 },
});

/** @type {readonly MetalPresetName[]} */
export const METAL_PRESET_NAMES = Object.freeze(/** @type {MetalPresetName[]} */ (Object.keys(METAL_PRESETS)));

/** Verdigris (basic copper carbonate) for the aged bronze cavities, linear. A dielectric, so not an F0. */
export const PATINA_COLOR = f0(0.09, 0.28, 0.2);
