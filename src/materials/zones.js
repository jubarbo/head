// @ts-check

/** @typedef {'skin' | 'antenna' | 'palp' | 'mandible' | 'eye' | 'ocellus'} Zone */

/** @type {readonly Zone[]} */
export const ZONES = Object.freeze(['skin', 'antenna', 'palp', 'mandible', 'eye', 'ocellus']);

/**
 * Viewer material zone for a GLB material name (named by tools/blender/build_head.py).
 * Tolerates the `.001` / `_1` suffixes Blender and three.js append to duplicated names.
 * @param {string} name
 * @returns {Zone | null}
 */
export function zoneForMaterial(name) {
  const base = name.replace(/([._]\d+)+$/, '');
  return /** @type {readonly string[]} */ (ZONES).includes(base) ? /** @type {Zone} */ (base) : null;
}
