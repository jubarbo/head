import { describe, it, expect } from 'vitest';
import { VIEW_NAMES, CAMERA_LIMITS, fitDistance, viewToLookAt } from '../src/controls/views.js';

describe('viewToLookAt', () => {
  const target = { x: 0, y: 0, z: 0 };

  it('places the front camera on +Z, facing the head', () => {
    const { position } = viewToLookAt('front', 10, target);
    expect(position.z).toBeCloseTo(10);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(0);
  });

  it("places the right camera on the head's right side (-X)", () => {
    const { position } = viewToLookAt('right', 10, target);
    expect(position.x).toBeCloseTo(-10);
    expect(Math.abs(position.z)).toBeLessThan(1e-6);
  });

  it('places the top camera above and the bottom camera below', () => {
    expect(viewToLookAt('top', 10, target).position.y).toBeGreaterThan(9.9);
    expect(viewToLookAt('bottom', 10, target).position.y).toBeLessThan(-9.9);
  });

  it('keeps the requested distance and offsets by the target', () => {
    const t = { x: 1, y: 2, z: 3 };
    const { position, target: out } = viewToLookAt('top', 7, t);
    const d = Math.hypot(position.x - 1, position.y - 2, position.z - 3);
    expect(d).toBeCloseTo(7);
    expect(out).toEqual(t);
  });

  it('rejects unknown views', () => {
    expect(() => viewToLookAt('back-ish', 10, target)).toThrow(/Unknown view/);
  });
});

describe('CAMERA_LIMITS', () => {
  it('lets every preset view be reached without clamping', () => {
    for (const name of VIEW_NAMES) {
      const { polar, distance } = viewToLookAt(name, CAMERA_LIMITS.defaultDistance, { x: 0, y: 0, z: 0 });
      expect(polar).toBeGreaterThanOrEqual(CAMERA_LIMITS.minPolarAngle);
      expect(polar).toBeLessThanOrEqual(CAMERA_LIMITS.maxPolarAngle);
      expect(distance).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance);
      expect(distance).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
    }
  });
});

describe('fitDistance', () => {
  const radius = 2.6;
  const vfov = 35;
  const fits = (distance, aspect) => {
    const half = (vfov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(half) * aspect);
    return radius <= distance * Math.sin(Math.min(half, hHalf)) + 1e-9;
  };

  it('fits the head on a landscape screen', () => {
    const d = fitDistance(radius, vfov, 1.6);
    expect(fits(d, 1.6)).toBe(true);
  });

  it('moves the camera back on a portrait phone so the eyes are not cut off', () => {
    const landscape = fitDistance(radius, vfov, 1.6);
    const portrait = fitDistance(radius, vfov, 390 / 844);
    expect(portrait).toBeGreaterThan(landscape);
    expect(fits(portrait, 390 / 844)).toBe(true);
  });

  it('stays inside the zoom limits', () => {
    expect(fitDistance(100, vfov, 0.2)).toBe(CAMERA_LIMITS.maxDistance);
    expect(fitDistance(0.1, vfov, 1)).toBe(CAMERA_LIMITS.minDistance);
  });
});

describe('pan bounds', () => {
  it('keep the head reachable: preset targets are inside and the bounds are finite', () => {
    const { panBounds } = CAMERA_LIMITS;
    for (const axis of ['x', 'y', 'z']) {
      expect(panBounds.min[axis]).toBeLessThanOrEqual(0);
      expect(panBounds.max[axis]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(panBounds.max[axis] - panBounds.min[axis])).toBe(true);
    }
  });
});
