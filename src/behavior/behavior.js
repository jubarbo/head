// @ts-check

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
});

const MAX_DELTA = 0.1; // a long frame must not look like a teleport
const SACCADE_RATE = 18; // per second: a jump settles in about 0.2 s
const REST_RATE = 6; // calmer than a jump: going to rest is not a reaction
const DEAD_ZONE = 2 * DEG; // smaller gaze changes do not earn a jump
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
  const pose = { yaw: 0, pitch: 0, roll: 0 };
  const goal = { yaw: 0, pitch: 0 };
  const explore = { yaw: 0, pitch: 0, wait: 1 };
  let pauseLeft = 0;
  let peeringWait = 0;
  let peeringTime = -1; // < 0 when not swaying
  let peeringGate = 1;

  const between = (/** @type {number} */ low, /** @type {number} */ high) => low + (high - low) * random();

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

      if (resting) {
        const step = approach(REST_RATE, dt);
        pose.yaw -= pose.yaw * step;
        pose.pitch -= pose.pitch * step;
        pose.roll -= pose.roll * step;
        goal.yaw = 0;
        goal.pitch = 0;
        return pose;
      }

      const limit = state.range * DEG;
      const tracking = Boolean(state.followPointer && state.headOn && target);
      updateExploration(dt);

      const wanted = !state.headOn ? { yaw: 0, pitch: 0 } : tracking && target ? target : explore;
      const yaw = state.headOn ? softClamp(wanted.yaw * state.intensity, limit) : 0;
      const pitch = state.headOn ? softClamp(wanted.pitch * state.intensity, limit) : 0;

      pauseLeft -= dt;
      if (!state.headOn) {
        goal.yaw = 0;
        goal.pitch = 0;
      } else if (pauseLeft <= 0 && Math.hypot(yaw - goal.yaw, pitch - goal.pitch) > DEAD_ZONE) {
        goal.yaw = yaw;
        goal.pitch = pitch;
        pauseLeft = state.saccadePause * between(0.6, 1.4);
      }

      const step = approach(SACCADE_RATE, dt);
      pose.yaw += (goal.yaw - pose.yaw) * step;
      pose.pitch += (goal.pitch - pose.pitch) * step;
      pose.roll = updatePeering(dt, tracking) * state.intensity;
      return pose;
    },
  };
}
