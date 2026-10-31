import { describe, it, expect } from 'vitest';
import calibration from '../assets-src/reference/calibration.json';
import { pixelToPlane, planeLayout, planeBasis } from '../src/reference/calibration.js';
import { viewToLookAt } from '../src/controls/views.js';

const front = calibration.views.front;

describe('pixelToPlane', () => {
  it('maps the calibration origin pixel to the origin UV', () => {
    expect(pixelToPlane(front, ...front.originPx)).toEqual({ u: 0, v: 0 });
    const top = calibration.views.top;
    const p = pixelToPlane(top, ...top.originPx);
    expect(p.u).toBeCloseTo(0);
    expect(p.v).toBeCloseTo(0.25);
  });

  it('places the front head top, mandible tips and eye edge where the targets say', () => {
    expect(pixelToPlane(front, 266.5, 105).v).toBeCloseTo(1.75, 1);
    expect(pixelToPlane(front, 266.5, 549).v).toBeCloseTo(-1.75, 1);
    expect(pixelToPlane(front, 15, 220).u).toBeCloseTo(-calibration.targets.eyeOuterX, 1);
  });
});

describe('planeLayout', () => {
  it('sizes the plane from the crop and centers it relative to the origin pixel', () => {
    const { width, height, centerU, centerV } = planeLayout(front);
    expect(width).toBeCloseTo(560 * front.unitsPerPx);
    expect(height).toBeCloseTo(576 * front.unitsPerPx);
    expect(centerU).toBeCloseTo((280 - 266.5) * front.unitsPerPx);
    expect(centerV).toBeCloseTo((327 - 288) * front.unitsPerPx);
  });
});

describe('planeBasis', () => {
  it('faces each plane toward the camera of its preset view', () => {
    for (const [name, view] of Object.entries(calibration.views)) {
      const { u, v, normal } = planeBasis(view.axes);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(cross).toEqual(normal);
      const { position } = viewToLookAt(name, 10, { x: 0, y: 0, z: 0 });
      const facing = normal[0] * position.x + normal[1] * position.y + normal[2] * position.z;
      expect(facing, name).toBeGreaterThan(0);
    }
  });

  it('rejects unknown axis labels', () => {
    expect(() => planeBasis({ u: '+w', v: '+y' })).toThrow(/Unknown axis/);
  });
});
