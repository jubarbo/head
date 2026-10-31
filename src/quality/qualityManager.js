// @ts-check
import { QUALITY_TIERS, detectInitialTier } from './tiers.js';
import { createAdaptiveTier } from './adaptiveTier.js';

/**
 * Applies a quality tier to the renderer and, in auto mode, adapts it from measured fps
 * (src/quality/adaptiveTier.js). `onChange` also drives tier-dependent assets (cuticle map size).
 * @param {{ renderer: import('three').WebGLRenderer, scene: import('three').Scene, keyLight: import('three').DirectionalLight, post: { setTier: (settings: import('./tiers.js').TierSettings) => void } }} stage
 * @param {(tier: import('./tiers.js').TierName) => void} [onChange]
 */
export function createQualityManager({ renderer, scene, keyLight, post }, onChange = () => {}) {
  let auto = true;
  let tier = initialTier();
  let adaptive = createAdaptiveTier(tier);

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

    post.setTier(settings); // after setPixelRatio: the composer copies the renderer's ratio

    tier = next;
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
      const next = auto ? initialTier() : mode;
      adaptive = createAdaptiveTier(next); // back to auto forgets the tiers that failed before
      apply(next);
    },
    /** @param {number} deltaSeconds */
    sample(deltaSeconds) {
      if (!auto) return;
      const next = adaptive.push(deltaSeconds);
      if (next) apply(next);
    },
  };
}

function initialTier() {
  return detectInitialTier({
    isMobile: window.matchMedia('(pointer: coarse)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
}
