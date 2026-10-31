import { describe, it, expect, vi } from 'vitest';
import { Texture } from 'three';
import { createAdaptiveTier } from '../src/quality/adaptiveTier.js';
import { QUALITY_TIERS, TIER_ORDER } from '../src/quality/tiers.js';
import { createCuticleMaterial, swapCuticleMaps } from '../src/materials/cuticleMaterial.js';
import { textureSetFor } from '../src/materials/textureSet.js';
import { createLoadProgress } from '../src/ui/loadProgress.js';
import { watchContext } from '../src/scene/contextRecovery.js';

/** Feeds `seconds` of frames at `fps` and returns every tier change. */
const run = (adaptive, fps, seconds) => {
  const changes = [];
  for (let t = 0; t < seconds * fps; t++) {
    const next = adaptive.push(1 / fps);
    if (next) changes.push(next);
  }
  return changes;
};

describe('adaptive tier', () => {
  it('steps down one tier at a time under a sustained low frame rate', () => {
    const adaptive = createAdaptiveTier('high');
    expect(run(adaptive, 20, 8)).toEqual(['medium', 'low']);
    expect(adaptive.tier).toBe('low');
  });

  it('steps up from a tier that never failed', () => {
    const adaptive = createAdaptiveTier('medium');
    expect(run(adaptive, 60, 3)).toEqual(['high']);
  });

  it('never returns to a tier that failed, so vsync cannot make it oscillate', () => {
    const adaptive = createAdaptiveTier('high');
    expect(run(adaptive, 20, 3)).toEqual(['medium']);
    expect(run(adaptive, 60, 30)).toEqual([]);
    expect(adaptive.tier).toBe('medium');
  });

  it('can still recover tiers below the one that failed', () => {
    const adaptive = createAdaptiveTier('high');
    run(adaptive, 20, 8); // high and medium both failed → low
    expect(run(adaptive, 60, 30)).toEqual([]);
    expect(adaptive.tier).toBe('low');

    const fromMedium = createAdaptiveTier('medium');
    expect(run(fromMedium, 20, 3)).toEqual(['low']);
    expect(run(fromMedium, 60, 30)).toEqual([]); // medium failed, high is above it
  });
});

describe('renderer settings per tier', () => {
  it('leaves antialiasing to SMAA: no tier asks for renderer MSAA', () => {
    for (const tier of TIER_ORDER) expect(QUALITY_TIERS[tier]).not.toHaveProperty('antialias');
  });

  it('caps the pixel ratio at 1 / 1.5 / 2', () => {
    expect(TIER_ORDER.map((tier) => QUALITY_TIERS[tier].maxPixelRatio)).toEqual([1, 1.5, 2]);
  });
});

describe('cuticle map swap', () => {
  const mapsOf = (size) => {
    const maps = { albedo: new Texture(), normal: new Texture(), orm: new Texture() };
    for (const texture of Object.values(maps)) texture.userData.size = size;
    return maps;
  };

  it('replaces every map on every material, disposes the old textures once, and keeps the program', () => {
    const old = mapsOf(2048);
    const materials = [createCuticleMaterial('skin', old), createCuticleMaterial('antenna', old)];
    const versions = materials.map((m) => m.version);
    const disposed = Object.values(old).map((texture) => vi.spyOn(texture, 'dispose'));

    const next = mapsOf(1024);
    expect(swapCuticleMaps(materials, next)).toBe(true);

    for (const material of materials) {
      expect(material.map).toBe(next.albedo);
      expect(material.normalMap).toBe(next.normal);
      expect(material.aoMap).toBe(next.orm);
      expect(material.roughnessMap).toBe(next.orm);
    }
    expect(materials.map((m) => m.version)).toEqual(versions);
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('leaves flat-color materials alone (adding maps would recompile them)', () => {
    const material = createCuticleMaterial('skin', null);
    expect(swapCuticleMaps([material], mapsOf(1024))).toBe(false);
    expect(material.map).toBeNull();
  });

  it('only needs a swap when the tier changes the shipped size', () => {
    expect(textureSetFor('low', '').size).toBe(1024);
    expect(textureSetFor('medium', '').size).toBe(textureSetFor('high', '').size);
  });
});

describe('load progress', () => {
  it('never goes backwards when more files are discovered', () => {
    const progress = createLoadProgress();
    expect(progress.update(1, 2)).toBe(0.5);
    expect(progress.update(1, 5)).toBe(0.5);
    expect(progress.update(4, 5)).toBeCloseTo(0.8);
  });

  it('stays below 100% until the scene is ready', () => {
    const progress = createLoadProgress();
    expect(progress.update(5, 5)).toBeLessThan(1);
    expect(progress.finish()).toBe(1);
  });
});

describe('WebGL context loss', () => {
  it('reports loss (keeping the context restorable) and restoration', () => {
    const canvas = new EventTarget();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    watchContext(/** @type {any} */ (canvas), { onLost, onRestored });

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('ignores a restore without a previous loss', () => {
    const canvas = new EventTarget();
    const onRestored = vi.fn();
    watchContext(/** @type {any} */ (canvas), { onLost: () => {}, onRestored });
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onRestored).not.toHaveBeenCalled();
  });
});
