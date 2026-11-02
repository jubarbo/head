import { describe, it, expect } from 'vitest';
import { PALETTE } from '../src/materials/palette.js';
import { zoneForMaterial } from '../src/materials/zones.js';
import { pseudopupilAxis, pseudopupilFactor, ommatidiaVisibility, PSEUDOPUPIL } from '../src/materials/eyeOptics.js';

describe('palette', () => {
  it('matches the reference sheet colors (S1)', () => {
    expect(PALETTE).toEqual({
      green: '#8AA84B', olive: '#7A8238', antennaBrown: '#A8764A',
      mandibleBrown: '#5C3F2E', darkGray: '#4A4644', cream: '#E6D2C0',
    });
  });
});

describe('material zones', () => {
  it('maps the GLB clay material names to viewer materials', () => {
    for (const zone of ['skin', 'antenna', 'palp', 'mandible', 'eye', 'ocellus']) expect(zoneForMaterial(zone)).toBe(zone);
  });

  it('accepts the numeric suffixes three.js/Blender add to duplicated names', () => {
    expect(zoneForMaterial('skin.001')).toBe('skin');
    expect(zoneForMaterial('eye_1')).toBe('eye');
  });

  it('leaves unknown materials untouched', () => {
    expect(zoneForMaterial('ShadowMaterial')).toBeNull();
    expect(zoneForMaterial('')).toBeNull();
  });
});

describe('pseudopupil (view-dependent dark spot of the compound eye)', () => {
  const cos = (deg) => Math.cos((deg * Math.PI) / 180);

  it('is fully dark where the facets look straight at the camera', () => {
    expect(pseudopupilFactor(1)).toBe(1);
    expect(pseudopupilFactor(cos(PSEUDOPUPIL.innerDeg))).toBeCloseTo(1, 6);
  });

  it('vanishes outside its angular radius, so it follows the view instead of staying painted', () => {
    expect(pseudopupilFactor(cos(PSEUDOPUPIL.outerDeg))).toBeCloseTo(0, 6);
    expect(pseudopupilFactor(0)).toBe(0);
    expect(pseudopupilFactor(-1)).toBe(0);
  });

  it('fades monotonically between both radii', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => pseudopupilFactor(cos(PSEUDOPUPIL.outerDeg + (PSEUDOPUPIL.innerDeg - PSEUDOPUPIL.outerDeg) * t)));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  });
});

describe('pseudopupil axis (reference sheet: sits toward the outer side of the eye)', () => {
  const lateral = [1, 0, 0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it('is displaced from the view direction toward the outer side of the eye', () => {
    const view = [0, 0, 1];
    const axis = pseudopupilAxis(view, lateral);
    expect(axis[0]).toBeGreaterThan(0);
    expect(dot(axis, lateral)).toBeGreaterThan(dot(view, lateral));
    expect(Math.hypot(...axis)).toBeCloseTo(1, 6);
  });

  it('points the other way on the opposite eye', () => {
    expect(pseudopupilAxis([0, 0, 1], [-1, 0, 0])[0]).toBeLessThan(0);
  });

  it('still follows the view, so the spot is not painted on the eye', () => {
    const fromFront = pseudopupilAxis([0, 0, 1], lateral);
    const fromAbove = pseudopupilAxis([0, 1, 0], lateral);
    expect(dot(fromFront, fromAbove)).toBeLessThan(0.99);
    expect(fromAbove[1]).toBeGreaterThan(fromFront[1]);
  });
});

describe('ommatidia anti-aliasing', () => {
  it('shows the facets when each covers several pixels', () => {
    expect(ommatidiaVisibility(1 / 6)).toBe(1); // 6 px per facet
  });

  it('fades the facets out before they shrink below ~2 px, which would cause moiré', () => {
    expect(ommatidiaVisibility(1 / 2)).toBe(0);
    expect(ommatidiaVisibility(4)).toBe(0);
    const mid = ommatidiaVisibility(1 / 3);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
