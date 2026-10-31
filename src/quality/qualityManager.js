// @ts-check
import { QUALITY_TIERS, detectInitialTier, stepTier } from './tiers.js';
import { createFpsMonitor } from './fpsMonitor.js';

/**
 * Applies a quality tier to the renderer and, in auto mode, adapts it from measured fps.
 * Antialiasing is fixed at renderer creation, so it only follows the initial tier.
 * @param {{ renderer: import('three').WebGLRenderer, scene: import('three').Scene, keyLight: import('three').DirectionalLight }} stage
 * @param {(tier: import('./tiers.js').TierName) => void} [onChange]
 */
export function createQualityManager({ renderer, scene, keyLight }, onChange = () => {}) {
  const monitor = createFpsMonitor();
  let auto = true;
  let tier = initialTier();

  /** @param {import('./tiers.js').TierName} next */
  function apply(next) {
    const settings = QUALITY_TIERS[next];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio));

    const shadowsChanged = renderer.shadowMap.enabled !== settings.shadows;
    renderer.shadowMap.enabled = settings.shadows;
    if (keyLight.shadow.mapSize.x !== settings.shadowMapSize) {
      keyLight.shadow.mapSize.setScalar(settings.shadowMapSize);
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
    }
    if (shadowsChanged) {
      scene.traverse((object) => {
        const material = /** @type {any} */ (object).material;
        if (material) material.needsUpdate = true;
      });
    }

    tier = next;
    monitor.reset();
    onChange(tier);
  }

  apply(tier);

  return {
    get tier() { return tier; },
    get auto() { return auto; },
    get settings() { return QUALITY_TIERS[tier]; },
    /** @param {'auto' | import('./tiers.js').TierName} mode */
    setMode(mode) {
      auto = mode === 'auto';
      apply(auto ? initialTier() : mode);
    },
    /** @param {number} deltaSeconds */
    sample(deltaSeconds) {
      if (!auto) return;
      const suggestion = monitor.push(deltaSeconds);
      if (suggestion === 'down' && tier !== 'low') apply(stepTier(tier, -1));
      if (suggestion === 'up' && tier !== 'high') apply(stepTier(tier, 1));
    },
  };
}

function initialTier() {
  return detectInitialTier({
    isMobile: window.matchMedia('(pointer: coarse)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
}
