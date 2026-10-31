// @ts-check
import { TIER_ORDER, stepTier } from './tiers.js';
import { createFpsMonitor } from './fpsMonitor.js';

/**
 * Auto quality: follows the fps monitor's suggestions one tier at a time, but never climbs back to a
 * tier that already failed. Without that ceiling a 60 Hz display oscillates: the cheaper tier hits the
 * vsync cap, which reads as "fast", and the expensive one drops below the floor again.
 * @param {import('./tiers.js').TierName} initial
 * @param {Parameters<typeof createFpsMonitor>[0]} [monitorOptions]
 */
export function createAdaptiveTier(initial, monitorOptions) {
  const monitor = createFpsMonitor(monitorOptions);
  let tier = initial;
  let ceiling = TIER_ORDER.length - 1; // highest tier index still allowed

  return {
    get tier() { return tier; },
    /**
     * @param {number} deltaSeconds
     * @returns {import('./tiers.js').TierName | null} the new tier when it changes
     */
    push(deltaSeconds) {
      const suggestion = monitor.push(deltaSeconds);
      const index = TIER_ORDER.indexOf(tier);
      if (suggestion === 'down' && index > 0) {
        ceiling = index - 1;
        tier = stepTier(tier, -1);
        return tier;
      }
      if (suggestion === 'up' && index < ceiling) {
        tier = stepTier(tier, 1);
        return tier;
      }
      return null;
    },
  };
}
