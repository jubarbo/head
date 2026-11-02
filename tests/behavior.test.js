import { describe, it, expect } from 'vitest';
import { createBehavior, gazeAngles, softClamp, LIFE_DEFAULTS } from '../src/behavior/behavior.js';

const DEG = Math.PI / 180;
const FRAME = 1 / 60;
const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
/** Runs `seconds` of frames and returns every pose. */
function run(life, seconds, input = {}) {
  const poses = [];
  for (let t = 0; t < seconds; t += FRAME) poses.push({ ...life.update(FRAME, input) });
  return poses;
}
const quiet = (overrides = {}) => {
  const life = createBehavior(seeded());
  life.set({ peeringOn: false, ...overrides });
  return life;
};

describe('softClamp', () => {
  it('leaves small values almost untouched', () => expect(softClamp(0.05, 0.5)).toBeCloseTo(0.05, 2));
  it('never reaches the limit, on both sides', () => {
    expect(softClamp(50, 0.5)).toBeLessThanOrEqual(0.5);
    expect(softClamp(-50, 0.5)).toBeGreaterThanOrEqual(-0.5);
  });
  it('keeps turning a little past the limit instead of stopping dead', () => {
    expect(softClamp(0.6, 0.5)).toBeGreaterThan(softClamp(0.5, 0.5));
  });
});

describe('gazeAngles', () => {
  it('looks straight ahead along +Z', () => {
    expect(gazeAngles(0, 0, 1)).toEqual({ yaw: 0, pitch: 0 });
  });
  it('turns toward +X and up', () => {
    const { yaw, pitch } = gazeAngles(1, 1, 1);
    expect(yaw).toBeCloseTo(Math.PI / 4, 6);
    expect(pitch).toBeGreaterThan(0);
  });
  it('ignores targets behind the head', () => {
    expect(gazeAngles(0, 0, -1)).toBeNull();
  });
});

describe('head tracking', () => {
  const target = { yaw: 20 * DEG, pitch: 0 };

  it('reaches the target within half a second of the first jump', () => {
    const life = quiet();
    const poses = run(life, 0.5 + LIFE_DEFAULTS.saccadePause * 1.4, { target });
    expect(poses.at(-1).yaw).toBeCloseTo(softClamp(target.yaw, LIFE_DEFAULTS.range * DEG), 2);
  });

  it('jumps fast on a large change, but follows a slow target far more gently', () => {
    const peakSpeed = (target) => {
      const life = quiet();
      run(life, 1, { target: { yaw: 0, pitch: 0 } });
      let yaw = life.pose.yaw;
      let peak = 0;
      for (let i = 0; i < 180; i++) {
        const next = life.update(FRAME, { target: { yaw: target(i * FRAME), pitch: 0 } }).yaw;
        peak = Math.max(peak, Math.abs(next - yaw) / FRAME);
        yaw = next;
      }
      return peak;
    };
    expect(peakSpeed(() => 25 * DEG)).toBeGreaterThan(1.5);
    expect(peakSpeed((t) => 10 * DEG * Math.sin(t * 1.2))).toBeLessThan(0.5);
  });

  it('accelerates into a jump instead of starting at full speed', () => {
    const life = quiet();
    run(life, 1, { target: { yaw: 0, pitch: 0 } });
    const speeds = [];
    let yaw = life.pose.yaw;
    for (let i = 0; i < 20; i++) {
      const next = life.update(FRAME, { target: { yaw: 20 * DEG, pitch: 0 } }).yaw;
      speeds.push(Math.abs(next - yaw) / FRAME);
      yaw = next;
    }
    const peak = Math.max(...speeds);
    expect(speeds[0]).toBeLessThan(peak * 0.6);
    expect(speeds.indexOf(peak)).toBeGreaterThan(0);
  });

  it('overshoots a jump very slightly and settles', () => {
    const life = quiet();
    run(life, 1, { target: { yaw: 0, pitch: 0 } });
    const poses = run(life, 1.5, { target: { yaw: 20 * DEG, pitch: 0 } });
    const goal = poses.at(-1).yaw;
    const top = Math.max(...poses.map((pose) => pose.yaw));
    expect(top).toBeGreaterThan(goal * 1.005);
    expect(top).toBeLessThan(goal * 1.12);
  });

  it('never freezes or falls far behind a slow pointer', () => {
    const life = quiet();
    let frozen = 0;
    let lag = 0;
    let previous = life.pose.yaw;
    for (let i = 0; i < 600; i++) {
      const target = softClamp(15 * DEG * Math.sin(i * FRAME * 1.2), LIFE_DEFAULTS.range * DEG);
      const yaw = life.update(FRAME, { target: { yaw: target, pitch: 0 } }).yaw;
      if (Math.abs(yaw - previous) < 1e-5) frozen++;
      if (i > 120) lag = Math.max(lag, Math.abs(yaw - target));
      previous = yaw;
    }
    expect(frozen / 600).toBeLessThan(0.05);
    expect(lag).toBeLessThan(7 * DEG);
  });

  it('stays inside the range for any target', () => {
    const life = quiet({ range: 30 });
    const poses = run(life, 3, { target: { yaw: 3, pitch: -3 } });
    for (const pose of poses) {
      expect(Math.abs(pose.yaw)).toBeLessThanOrEqual(30 * DEG);
      expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(30 * DEG);
    }
  });

  it('never jumps abruptly at the limit: the last step of a huge target is small', () => {
    const life = quiet({ range: 30 });
    const poses = run(life, 3, { target: { yaw: 3, pitch: 0 } });
    expect(Math.abs(poses.at(-1).yaw - poses.at(-2).yaw)).toBeLessThan(0.001);
  });

  it('ignores the pointer with Follow off', () => {
    const life = quiet({ followPointer: false, intensity: 1 });
    const poses = run(life, 0.2, { target });
    expect(Math.abs(poses.at(-1).yaw)).toBeLessThan(target.yaw / 4);
  });

  it('holds the head at rest with Head off', () => {
    const life = quiet({ headOn: false });
    for (const pose of run(life, 5, { target })) expect(pose.yaw).toBe(0);
  });

  it('scales the movement with Intensity', () => {
    const half = quiet({ intensity: 0.5 });
    const full = quiet({ intensity: 1 });
    const seconds = 2;
    expect(run(half, seconds, { target }).at(-1).yaw).toBeLessThan(run(full, seconds, { target }).at(-1).yaw * 0.7);
  });

  it('waits longer between jumps with a larger Saccade pause', () => {
    const jumps = (saccadePause) => {
      const life = quiet({ saccadePause });
      let count = 0;
      let last = 0;
      for (let i = 0; i < 1200; i++) {
        const yaw = 25 * DEG * Math.sign(Math.sin(i * FRAME * 9));
        const next = life.update(FRAME, { target: { yaw, pitch: 0 } }).yaw;
        if (Math.abs(next - last) > 0.03) count++;
        last = next;
      }
      return count;
    };
    expect(jumps(2)).toBeLessThan(jumps(0.3));
  });

  it('reaches the target sooner at a higher Speed', () => {
    const framesToArrive = (speed) => {
      const life = quiet({ speed });
      let frames = 0;
      while (life.update(FRAME, { target }).yaw < target.yaw * 0.8 && frames < 600) frames++;
      return frames;
    };
    expect(framesToArrive(2)).toBeLessThan(framesToArrive(0.5));
  });
});

describe('idle behavior', () => {
  it('looks around by itself when nobody is pointing, without a repeating cycle', () => {
    const life = quiet();
    const yaws = run(life, 60).map((pose) => pose.yaw);
    expect(Math.max(...yaws.map(Math.abs))).toBeGreaterThan(3 * DEG);
    const first = yaws.slice(600, 1200);
    const later = yaws.slice(1800, 2400);
    const difference = first.reduce((sum, yaw, i) => sum + Math.abs(yaw - later[i]), 0) / first.length;
    expect(difference).toBeGreaterThan(0.005);
  });

  it('is never exactly frozen: a resting mantis keeps a tiny sway', () => {
    const poses = run(quiet(), 30).slice(60);
    const frozen = poses.filter((pose, i) => i && Math.abs(pose.yaw - poses[i - 1].yaw) < 1e-6).length;
    expect(frozen / poses.length).toBeLessThan(0.05);
  });

  it('spends most of its time motionless', () => {
    const poses = run(quiet(), 60);
    const moving = poses.filter((pose, i) => i && Math.abs(pose.yaw - poses[i - 1].yaw) > 0.0005).length;
    expect(moving / poses.length).toBeLessThan(0.3);
  });
});

describe('peering', () => {
  it('sways sideways when idle', () => {
    const life = createBehavior(seeded());
    life.set({ peeringFrequency: 20, peeringAmplitude: 6 });
    const rolls = run(life, 30).map((pose) => pose.roll);
    expect(Math.max(...rolls)).toBeGreaterThan(2 * DEG);
    expect(Math.min(...rolls)).toBeLessThan(-2 * DEG);
  });

  it('does nothing when off or at frequency 0', () => {
    for (const settings of [{ peeringOn: false }, { peeringFrequency: 0 }]) {
      const life = createBehavior(seeded());
      life.set(settings);
      for (const pose of run(life, 30)) expect(pose.roll).toBe(0);
    }
  });

  it('fades away while the head is tracking', () => {
    const life = createBehavior(seeded());
    life.set({ peeringFrequency: 60 });
    const rolls = run(life, 10, { target: { yaw: 0.2, pitch: 0 } }).slice(120).map((pose) => Math.abs(pose.roll));
    expect(Math.max(...rolls)).toBeLessThan(0.002);
  });

  it('follows Amplitude', () => {
    const peak = (peeringAmplitude) => {
      const life = createBehavior(seeded());
      life.set({ peeringFrequency: 20, peeringAmplitude });
      return Math.max(...run(life, 30).map((pose) => pose.roll));
    };
    expect(peak(10)).toBeGreaterThan(peak(3) * 1.5);
  });
});

describe('Alive and pause', () => {
  it('returns smoothly to rest with Alive off and stays there', () => {
    const life = createBehavior(seeded());
    run(life, 2, { target: { yaw: 0.4, pitch: 0.2 } });
    life.set({ alive: false });
    const poses = run(life, 2, { target: { yaw: 0.4, pitch: 0.2 } });
    expect(Math.abs(poses[1].yaw)).toBeGreaterThan(0.01);
    expect(Math.abs(poses.at(-1).yaw)).toBeLessThan(1e-3);
    expect(Math.abs(poses.at(-1).pitch)).toBeLessThan(1e-3);
  });

  it('returns to rest while paused (reference overlay) and resumes afterwards', () => {
    const life = quiet();
    const target = { yaw: 0.3, pitch: 0 };
    run(life, 2, { target });
    expect(Math.abs(run(life, 2, { target, paused: true }).at(-1).yaw)).toBeLessThan(1e-3);
    expect(run(life, 2, { target }).at(-1).yaw).toBeGreaterThan(0.2);
  });

  it('survives a huge frame without overshooting', () => {
    const life = quiet();
    expect(Math.abs(life.update(30, { target: { yaw: 0.3, pitch: 0 } }).yaw)).toBeLessThanOrEqual(0.3);
  });
});

describe('settings', () => {
  it('reset restores every default', () => {
    const life = createBehavior(seeded());
    life.set({ alive: false, intensity: 0.2, range: 10, peeringAmplitude: 1 });
    life.reset();
    expect(life.state).toEqual(LIFE_DEFAULTS);
  });

  it('starts from the given overrides', () => {
    expect(createBehavior(seeded(), { alive: false }).state.alive).toBe(false);
  });
});
