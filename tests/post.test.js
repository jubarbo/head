import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import { passOrder } from '../src/post/passOrder.js';
import { contactShadowFrame } from '../src/post/contactShadowFrame.js';
import { QUALITY_TIERS } from '../src/quality/tiers.js';

describe('post pass order', () => {
  it('renders, then AO, then bloom in linear HDR, then tone maps, then anti-aliases', () => {
    expect(passOrder(QUALITY_TIERS.high)).toEqual(['render', 'gtao', 'bloom', 'output', 'smaa']);
  });

  it('drops the passes a tier disables', () => {
    expect(passOrder(QUALITY_TIERS.medium)).toEqual(['render', 'bloom', 'output', 'smaa']);
    expect(passOrder(QUALITY_TIERS.low)).toEqual(['render', 'output']);
  });
});

describe('contact shadow frame', () => {
  const box = new Box3(new Vector3(-2, -3.15, -1.5), new Vector3(2, 2, 1));

  it('sits just below the lowest point of the model', () => {
    const frame = contactShadowFrame(box);
    expect(frame.y).toBeLessThan(-3.15);
    expect(frame.y).toBeGreaterThan(-3.4);
  });

  it('centers on the footprint and covers it with a margin', () => {
    const frame = contactShadowFrame(box);
    expect(frame.center).toEqual({ x: 0, z: -0.25 });
    expect(frame.width).toBeGreaterThan(4);
    expect(frame.depth).toBeGreaterThan(2.5);
  });

  it('captures the whole height of the model', () => {
    expect(contactShadowFrame(box).far).toBeGreaterThanOrEqual(5.15);
  });
});
