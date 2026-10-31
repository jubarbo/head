import { describe, it, expect } from 'vitest';
import { QUALITY_TIERS, TIER_ORDER, detectInitialTier, stepTier } from '../src/quality/tiers.js';
import { createFpsMonitor } from '../src/quality/fpsMonitor.js';

describe('quality tiers', () => {
  it('defines low < medium < high in cost', () => {
    expect(TIER_ORDER).toEqual(['low', 'medium', 'high']);
    expect(QUALITY_TIERS.low.maxPixelRatio).toBeLessThan(QUALITY_TIERS.high.maxPixelRatio);
    expect(QUALITY_TIERS.low.ambientOcclusion).toBe(false);
    expect(QUALITY_TIERS.high.ambientOcclusion).toBe(true);
  });

  it('starts mobile devices on medium and strong desktops on high', () => {
    expect(detectInitialTier({ isMobile: true, hardwareConcurrency: 8 })).toBe('medium');
    expect(detectInitialTier({ isMobile: false, hardwareConcurrency: 8 })).toBe('high');
  });

  it('starts weak devices on low', () => {
    expect(detectInitialTier({ isMobile: true, hardwareConcurrency: 2 })).toBe('low');
    expect(detectInitialTier({ isMobile: false, hardwareConcurrency: 2 })).toBe('medium');
  });

  it('steps tiers and clamps at the ends', () => {
    expect(stepTier('high', -1)).toBe('medium');
    expect(stepTier('low', -1)).toBe('low');
    expect(stepTier('high', 1)).toBe('high');
  });
});

describe('fps monitor', () => {
  const feed = (monitor, fps, seconds) => {
    const out = [];
    for (let t = 0; t < seconds * fps; t++) {
      const r = monitor.push(1 / fps);
      if (r) out.push(r);
    }
    return out;
  };

  it('asks to go down once after a sustained low frame rate, then cools down', () => {
    const m = createFpsMonitor({ windowSeconds: 2, lowFps: 28, highFps: 55, cooldownSeconds: 3 });
    expect(feed(m, 20, 2)).toEqual(['down']);
    expect(feed(m, 20, 2)).toEqual([]); // still cooling down
  });

  it('asks to go up after a sustained high frame rate', () => {
    const m = createFpsMonitor({ windowSeconds: 2, lowFps: 28, highFps: 55, cooldownSeconds: 0 });
    expect(feed(m, 60, 2.1)).toContain('up');
  });

  it('stays quiet in the comfortable band', () => {
    const m = createFpsMonitor({ windowSeconds: 2, lowFps: 28, highFps: 55, cooldownSeconds: 0 });
    expect(feed(m, 40, 6)).toEqual([]);
  });

  it('ignores huge frame gaps such as a hidden tab', () => {
    const m = createFpsMonitor({ windowSeconds: 2, lowFps: 28, highFps: 55, cooldownSeconds: 0 });
    expect(m.push(5)).toBeNull();
    expect(feed(m, 40, 3)).toEqual([]);
  });
});
