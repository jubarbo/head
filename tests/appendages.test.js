import { describe, it, expect } from 'vitest';
import { createBehavior } from '../src/behavior/behavior.js';
import { antennaBoneRotation } from '../src/behavior/appendages.js';

const DEG = Math.PI / 180;
const FRAME = 1 / 60;
const seeded = (seed = 3) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
function run(life, seconds, input = {}) {
  const poses = [];
  for (let t = 0; t < seconds; t += FRAME) poses.push(clone(life.update(FRAME, input)));
  return poses;
}
const create = (settings = {}) => {
  const life = createBehavior(seeded());
  life.set({ headOn: false, peeringOn: false, ...settings });
  return life;
};
const peak = (values) => Math.max(...values.map(Math.abs));

describe('antennae', () => {
  it('move independently of each other', () => {
    const poses = run(create(), 20);
    const difference = poses.reduce((sum, pose) => sum + Math.abs(pose.antennae.left.swing - pose.antennae.right.swing), 0);
    expect(difference / poses.length).toBeGreaterThan(0.01);
  });

  it('stay within about their Amplitude', () => {
    const poses = run(create({ antennaAmplitude: 10 }), 30);
    expect(peak(poses.map((pose) => pose.antennae.left.swing))).toBeLessThan(10 * 1.5 * DEG);
    expect(peak(poses.map((pose) => pose.antennae.left.swing))).toBeGreaterThan(3 * DEG);
  });

  it('scale with Amplitude', () => {
    const swing = (antennaAmplitude) => peak(run(create({ antennaAmplitude }), 30).map((pose) => pose.antennae.left.swing));
    expect(swing(20)).toBeGreaterThan(swing(5) * 1.5);
  });

  it('twitch more with higher Nervousness', () => {
    const twitches = (antennaNervousness) => {
      const poses = run(create({ antennaNervousness }), 60);
      return poses.filter((pose, i) => i && Math.abs(pose.antennae.left.swing - poses[i - 1].antennae.left.swing) > 0.004).length;
    };
    expect(twitches(1)).toBeGreaterThan(twitches(0));
  });

  it('lag behind a head jump', () => {
    const life = createBehavior(seeded());
    life.set({ peeringOn: false, antennaAmplitude: 1, antennaNervousness: 0, saccadePause: 0.1 });
    run(life, 1);
    const before = life.pose.antennae.left.swing;
    const poses = run(life, 0.25, { target: { yaw: 0.45, pitch: 0 } });
    expect(peak(poses.map((pose) => pose.antennae.left.swing - before))).toBeGreaterThan(0.02);
  });

  it('rest with Antennae off', () => {
    for (const pose of run(create({ antennaOn: false }), 5).slice(120)) {
      expect(Math.abs(pose.antennae.left.swing)).toBeLessThan(0.05);
    }
    expect(Math.abs(run(create({ antennaOn: false }), 8).at(-1).antennae.right.nod)).toBeLessThan(1e-3);
  });

  it('spread a bend along the chain, stronger toward the tip, adding up to the swing', () => {
    const antenna = { swing: 0.3, nod: -0.2, ripple: 0, phase: 0 };
    const rotations = [0, 1, 2, 3, 4, 5, 6].map((index) => antennaBoneRotation(antenna, index, 7));
    expect(rotations.reduce((sum, r) => sum + r.z, 0)).toBeCloseTo(0.3, 6);
    expect(rotations.reduce((sum, r) => sum + r.x, 0)).toBeCloseTo(-0.2, 6);
    expect(rotations[6].z).toBeGreaterThan(rotations[0].z);
  });
});

describe('mouthparts', () => {
  const mouth = (settings) => create({ antennaOn: false, mouthFrequency: 30, ...settings });

  it('tap the palps in short pulses, each side on its own', () => {
    const poses = run(mouth({ mandiblesOn: false }), 30);
    expect(peak(poses.map((pose) => pose.palps.left))).toBeGreaterThan(0.5);
    expect(peak(poses.map((pose) => pose.palps.right))).toBeGreaterThan(0.5);
    const shared = poses.filter((pose) => pose.palps.left > 0.1 && pose.palps.right > 0.1).length;
    const either = poses.filter((pose) => pose.palps.left > 0.1 || pose.palps.right > 0.1).length;
    expect(shared).toBeLessThan(either);
  });

  it('open the mandibles now and then', () => {
    const poses = run(mouth({ palpsOn: false }), 30);
    expect(peak(poses.map((pose) => pose.mandibles))).toBeGreaterThan(0.5);
    expect(poses.filter((pose) => pose.mandibles < 0.01).length / poses.length).toBeGreaterThan(0.5);
  });

  it('keep every pulse between 0 and 1, so parts only move away from the head', () => {
    for (const pose of run(mouth(), 30)) {
      for (const value of [pose.palps.left, pose.palps.right, pose.mandibles]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stay still when off or at frequency 0', () => {
    for (const settings of [{ palpsOn: false, mandiblesOn: false }, { mouthFrequency: 0 }]) {
      for (const pose of run(mouth(settings), 15)) {
        expect(pose.palps.left + pose.palps.right + pose.mandibles).toBe(0);
      }
    }
  });
});

describe('Alive off and pause', () => {
  it('bring every appendage back to rest', () => {
    const life = createBehavior(seeded());
    life.set({ mouthFrequency: 30 });
    run(life, 10);
    life.set({ alive: false });
    const { antennae, palps, mandibles } = run(life, 5).at(-1);
    const values = [antennae.left.swing, antennae.left.nod, antennae.right.swing, antennae.left.ripple, palps.left, palps.right, mandibles];
    expect(peak(values)).toBeLessThan(1e-3);
  });

  it('hold them at rest while paused', () => {
    const life = createBehavior(seeded());
    run(life, 5);
    expect(peak([run(life, 5, { paused: true }).at(-1).antennae.left.swing])).toBeLessThan(1e-3);
  });
});
