// @ts-check

/**
 * @typedef {'render' | 'gtao' | 'bloom' | 'output' | 'smaa'} PassName
 */

/**
 * Composer passes for a tier, in order. AO and bloom work on the linear HDR buffer, OutputPass
 * applies AgX + sRGB, and SMAA runs last because its edge detection expects display-referred color.
 * @param {Pick<import('../quality/tiers.js').TierSettings, 'ambientOcclusion' | 'bloom' | 'smaa'>} settings
 * @returns {PassName[]}
 */
export function passOrder({ ambientOcclusion, bloom, smaa }) {
  /** @type {PassName[]} */
  const order = ['render'];
  if (ambientOcclusion) order.push('gtao');
  if (bloom) order.push('bloom');
  order.push('output');
  if (smaa) order.push('smaa');
  return order;
}
