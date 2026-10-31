// @ts-check

/**
 * @typedef {'low' | 'medium' | 'high'} TierName
 * @typedef {{ maxPixelRatio: number, shadows: boolean, shadowMapSize: number, ambientOcclusion: boolean, bloom: boolean, smaa: boolean, textureSize: number }} TierSettings
 */

/** @type {readonly TierName[]} */
export const TIER_ORDER = Object.freeze(['low', 'medium', 'high']);

/** @type {Readonly<Record<TierName, TierSettings>>} */
export const QUALITY_TIERS = Object.freeze({
  low: { maxPixelRatio: 1, shadows: false, shadowMapSize: 512, ambientOcclusion: false, bloom: false, smaa: false, textureSize: 1024 },
  medium: { maxPixelRatio: 1.5, shadows: true, shadowMapSize: 1024, ambientOcclusion: false, bloom: true, smaa: true, textureSize: 2048 },
  high: { maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, ambientOcclusion: true, bloom: true, smaa: true, textureSize: 4096 },
});

/**
 * Initial guess before the fps monitor has data.
 * @param {{ isMobile: boolean, hardwareConcurrency?: number }} device
 * @returns {TierName}
 */
export function detectInitialTier({ isMobile, hardwareConcurrency = 4 }) {
  const weak = hardwareConcurrency <= 2;
  if (isMobile) return weak ? 'low' : 'medium';
  return weak ? 'medium' : 'high';
}

/**
 * @param {TierName} tier
 * @param {-1 | 1} direction
 * @returns {TierName}
 */
export function stepTier(tier, direction) {
  const i = TIER_ORDER.indexOf(tier) + direction;
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, i))];
}
