// @ts-check
import { createAppendages } from './appendages.js';

const DEG = Math.PI / 180;

/** Panel settings. Angles are degrees, frequency is sways per minute, times are seconds. */
export const LIFE_DEFAULTS = Object.freeze({
  alive: true,
  intensity: 1,
  speed: 1,
  headOn: true,
  followPointer: true,
  range: 30,
  saccadePause: 0.7,
  peeringOn: true,
  peeringFrequency: 4,
  peeringAmplitude: 5,
  antennaOn: true,
  antennaAmplitude: 12,
  antennaNervousness: 0.5,
  palpsOn: true,
  mandiblesOn: true,
  mouthFrequency: 6,
});

const MAX_DELTA = 0.1; // a long frame must not look like a teleport
// The head is a spring, not an exponential: it speeds up, overshoots a little and settles, while
// an exponential starts at top speed, which reads as a mechanical snap.
const SPRING = { rate: 20, damping: 0.75 }; // settles in about 0.3 s
const REST_SPRING = { rate: 7, damping: 1 }; // calmer than a jump: going to rest is not a reaction
const SPRING_STEP = 1 / 240; // fixed sub-step: the spring stays stable at any frame rate
const JUMP_ANGLE = 8 * DEG; // a tracked target further than this earns a jump; closer, the head glides
const IDLE_DEAD_ZONE = 2 * DEG;
const PURSUIT_RATE = 3; // per second: smooth following between jumps
const MICRO_AMPLITUDE = 0.25 * DEG; // a still mantis is never perfectly frozen
const MICRO_GATE_RATE = 4;
const PEERING_DURATION = 2.4;
const PEERING_SWAYS = 2;
const PEERING_GATE_RATE = 8;
const EXPLORE_WAIT = { min: 2, max: 6 };
const EXPLORE_STILL_CHANCE = 0.4; // often the "new place to look" is simply the front
const EXPLORE_REACH = 0.6; // fraction of the range: idle looks stay smaller than tracking

/**
 * Compresses a value toward ±limit: nearly linear when small, and it can never reach the limit, so
 * the head slows into it instead of stopping dead.
 * @param {number} value
 * @param {number} limit
 */
export function softClamp(value, limit) {
  return limit > 0 ? limit * Math.tanh(value / limit) : 0;
}

/**
 * Head rotation that points the face (+Z) along a direction in the head's frame.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{ yaw: number, pitch: number } | null} null when the direction is behind the head
 */
export function gazeAngles(x, y, z) {
  const length = Math.hypot(x, y, z);
  if (length === 0 || z < -0.2 * length) return null;
  return { yaw: Math.atan2(x, z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}

/** @param {number} rate @param {number} delta fraction to move toward a goal this frame, frame-rate independent */
const approach = (rate, delta) => 1 - Math.exp(-rate * delta);

/**
 * The mantis's behavior as pure state: stillness broken by quick jumps of the head. It knows nothing
 * of Three.js; each frame takes where to look and returns the pose, so it is deterministic under test.
 * @param {() => number} [random] source of the randomized timings
 * @param {Partial<typeof LIFE_DEFAULTS>} [overrides]
 */
export function createBehavior(random = Math.random, overrides = {}) {
  const state = { ...LIFE_DEFAULTS, ...overrides };
  const antenna = () => ({ swing: 0, nod: 0, ripple: 0, phase: 0 });
  const pose = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    antennae: { left: antenna(), right: antenna() },
    palps: { left: 0, right: 0 },
    mandibles: 0,
  };
  const updateAppendages = createAppendages(random, state, pose);
  const goal = { yaw: 0, pitch: 0 };
  const head = { yaw: 0, pitch: 0, yawSpeed: 0, pitchSpeed: 0 };
  let microTime = 0;
  let microGate = 0;
  const explore = { yaw: 0, pitch: 0, wait: 1 };
  let pauseLeft = 0;
  let peeringWait = 0;
  let peeringTime = -1; // < 0 when not swaying
  let peeringGate = 1;

  const between = (/** @type {number} */ low, /** @type {number} */ high) => low + (high - low) * random();

  /** Moves the head toward a pose along its spring. @param {{ yaw: number, pitch: number }} to @param {typeof SPRING} spring @param {number} dt */
  function moveHead(to, { rate, damping }, dt) {
    for (let left = dt; left > 0; left -= SPRING_STEP) {
      const h = Math.min(left, SPRING_STEP);
      head.yawSpeed += (rate * rate * (to.yaw - head.yaw) - 2 * damping * rate * head.yawSpeed) * h;
      head.pitchSpeed += (rate * rate * (to.pitch - head.pitch) - 2 * damping * rate * head.pitchSpeed) * h;
      head.yaw += head.yawSpeed * h;
      head.pitch += head.pitchSpeed * h;
    }
  }

  /** Writes the pose: the spring plus the micro-motion. @param {number} dt @param {boolean} on @param {number} limit */
  function writeHeadPose(dt, on, limit) {
    microTime += dt;
    microGate += ((on ? 1 : 0) - microGate) * approach(MICRO_GATE_RATE, dt);
    const microYaw = (Math.sin(microTime * 0.9) + 0.5 * Math.sin(microTime * 2.3 + 1)) * MICRO_AMPLITUDE * microGate;
    const microPitch = (Math.sin(microTime * 0.7 + 2) + 0.5 * Math.sin(microTime * 1.9)) * MICRO_AMPLITUDE * microGate;
    pose.yaw = Math.max(-limit, Math.min(limit, head.yaw + microYaw));
    pose.pitch = Math.max(-limit, Math.min(limit, head.pitch + microPitch));
  }

  /** @param {number} dt */
  function updateExploration(dt) {
    explore.wait -= dt;
    if (explore.wait > 0) return;
    explore.wait = between(EXPLORE_WAIT.min, EXPLORE_WAIT.max);
    const still = random() < EXPLORE_STILL_CHANCE;
    const reach = state.range * DEG * EXPLORE_REACH;
    explore.yaw = still ? 0 : between(-reach, reach);
    explore.pitch = still ? 0 : between(-reach, reach) * 0.5;
  }

  /** @param {number} dt @param {boolean} tracking @returns {number} sway in radians */
  function updatePeering(dt, tracking) {
    const active = state.peeringOn && state.peeringFrequency > 0;
    peeringGate += ((tracking ? 0 : 1) - peeringGate) * approach(PEERING_GATE_RATE, dt);
    if (!active) {
      peeringTime = -1;
      return 0;
    }
    if (peeringTime < 0) {
      peeringWait -= dt;
      if (peeringWait > 0) return 0;
      peeringTime = 0;
      peeringWait = (60 / state.peeringFrequency) * between(0.7, 1.3);
    }
    peeringTime += dt;
    const t = peeringTime / PEERING_DURATION;
    if (t >= 1) {
      peeringTime = -1;
      return 0;
    }
    const sway = Math.sin(Math.PI * 2 * PEERING_SWAYS * t) * Math.sin(Math.PI * t);
    return sway * state.peeringAmplitude * DEG * peeringGate;
  }

  return {
    state,
    pose,

    /** @param {Partial<typeof LIFE_DEFAULTS>} changes */
    set(changes) {
      Object.assign(state, changes);
    },

    reset() {
      Object.assign(state, LIFE_DEFAULTS);
    },

    /**
     * @param {number} delta seconds since the last frame
     * @param {{ target?: { yaw: number, pitch: number } | null, paused?: boolean }} [input]
     *   `target` is where the viewer points, null when nobody does; `paused` holds the rest pose
     */
    update(delta, { target = null, paused = false } = {}) {
      const dt = Math.min(delta, MAX_DELTA) * state.speed;
      const resting = !state.alive || paused;
      const previousYaw = pose.yaw;

      const limit = state.range * DEG;
      if (resting) {
        goal.yaw = 0;
        goal.pitch = 0;
        moveHead(goal, REST_SPRING, dt);
        pose.roll -= pose.roll * (1 - Math.exp(-REST_SPRING.rate * dt));
        writeHeadPose(dt, false, Infinity);
        updateAppendages(dt, true, 0);
        return pose;
      }

      const tracking = Boolean(state.followPointer && state.headOn && target);
      updateExploration(dt);

      const wanted = tracking && target ? target : explore;
      const yaw = state.headOn ? softClamp(wanted.yaw * state.intensity, limit) : 0;
      const pitch = state.headOn ? softClamp(wanted.pitch * state.intensity, limit) : 0;

      pauseLeft -= dt;
      const distance = Math.hypot(yaw - goal.yaw, pitch - goal.pitch);
      if (!state.headOn) {
        goal.yaw = 0;
        goal.pitch = 0;
      } else if (pauseLeft <= 0 && distance > (tracking ? JUMP_ANGLE : IDLE_DEAD_ZONE)) {
        goal.yaw = yaw;
        goal.pitch = pitch;
        pauseLeft = state.saccadePause * between(0.6, 1.4);
      } else if (tracking) {
        const glide = approach(PURSUIT_RATE, dt);
        goal.yaw += (yaw - goal.yaw) * glide;
        goal.pitch += (pitch - goal.pitch) * glide;
      }

      moveHead(goal, SPRING, dt);
      writeHeadPose(dt, state.headOn, limit);
      pose.roll = updatePeering(dt, tracking) * state.intensity;
      updateAppendages(dt, false, dt > 0 ? (pose.yaw - previousYaw) / dt : 0);
      return pose;
    },
  };
}
