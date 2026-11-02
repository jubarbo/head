// @ts-check

const DEG = Math.PI / 180;
const FOLLOW_RATE = 12; // per second: antennae are light, they settle fast
const REST_RATE = 6;
const TWITCH_ATTACK = 25;
const TWITCH_DECAY = 5;
const TWITCH_REACH = { min: 0.25, max: 0.5 }; // fraction of Amplitude
const MAX_TWITCHES_PER_SECOND = 0.6;
const LAG_GAIN = 0.12; // radians of antenna bend per radian/second of head turn
const LAG_LIMIT = 0.3;
const LAG_RATE = 10;
const PALP_TAP = 0.5; // seconds
const MANDIBLE_OPENING = 1.2;

/** @param {number} rate @param {number} dt */
const approach = (rate, dt) => 1 - Math.exp(-rate * dt);
/** @param {number} value @param {number} limit */
const limited = (value, limit) => Math.max(-limit, Math.min(limit, value));

/**
 * Rotation of one bone of an antenna chain. The bend grows toward the tip and adds up to `swing` and
 * `nod`; the ripple is a small wave traveling along the antenna.
 * @param {{ swing: number, nod: number, ripple: number, phase: number }} antenna
 * @param {number} index
 * @param {number} count
 * @returns {{ x: number, z: number }}
 */
export function antennaBoneRotation(antenna, index, count) {
  const share = (index + 1) / ((count * (count + 1)) / 2);
  const wave = antenna.ripple * Math.sin(antenna.phase - index * 0.9) * ((index + 1) / count);
  return { x: antenna.nod * share, z: antenna.swing * share + wave };
}

/** @returns {{ time: number, wait: number | null }} */
const createPulse = () => ({ time: -1, wait: null });

/**
 * Antennae and mouthparts, the small movements that run alongside the head. Writes into `pose`.
 * @param {() => number} random
 * @param {typeof import('./behavior.js').LIFE_DEFAULTS} state
 * @param {{ antennae: Record<'left' | 'right', { swing: number, nod: number, ripple: number, phase: number }>,
 *           palps: Record<'left' | 'right', number>, mandibles: number }} pose
 */
export function createAppendages(random, state, pose) {
  const between = (/** @type {number} */ low, /** @type {number} */ high) => low + (high - low) * random();
  const sides = /** @type {const} */ (['left', 'right']).map((name) => ({
    name,
    seeds: [0, 0, 0, 0].map(() => between(0, Math.PI * 2)), // each antenna wanders on its own
    twitch: 0,
    twitchGoal: 0,
    lag: 0,
  }));
  const palpPulses = { left: createPulse(), right: createPulse() };
  const mandiblePulse = createPulse();
  let time = 0;

  /**
   * A short movement that starts at random intervals and rises and falls between 0 and 1.
   * @param {ReturnType<typeof createPulse>} pulse
   * @param {boolean} enabled
   * @param {number} duration
   * @param {number} dt
   */
  function advance(pulse, enabled, duration, dt) {
    const interval = 60 / state.mouthFrequency;
    if (pulse.time < 0) {
      if (!enabled || !(state.mouthFrequency > 0)) return 0;
      pulse.wait = (pulse.wait ?? between(0, interval)) - dt;
      if (pulse.wait > 0) return 0;
      pulse.time = 0;
      pulse.wait = interval * between(0.5, 1.5);
    }
    pulse.time += dt;
    const t = pulse.time / duration;
    if (t >= 1) {
      pulse.time = -1;
      return 0;
    }
    return Math.sin(Math.PI * t) ** 2;
  }

  /** @param {typeof sides[number]} side @param {boolean} on @param {number} amplitude @param {number} headSpeed @param {number} dt */
  function updateAntenna(side, on, amplitude, headSpeed, dt) {
    const nervousness = state.antennaNervousness;
    const [a, b, c, d] = side.seeds;
    if (on && random() < nervousness * MAX_TWITCHES_PER_SECOND * dt) {
      side.twitchGoal = amplitude * between(TWITCH_REACH.min, TWITCH_REACH.max) * (random() < 0.5 ? -1 : 1);
    }
    side.twitchGoal -= side.twitchGoal * approach(TWITCH_DECAY, dt);
    side.twitch += (side.twitchGoal - side.twitch) * approach(TWITCH_ATTACK, dt);
    side.lag += (limited(-headSpeed * LAG_GAIN, LAG_LIMIT) - side.lag) * approach(LAG_RATE, dt);

    const antenna = pose.antennae[side.name];
    const wanderSwing = 0.6 * Math.sin(time * 0.37 + a) + 0.4 * Math.sin(time * 0.83 + b);
    const wanderNod = 0.6 * Math.sin(time * 0.29 + c) + 0.4 * Math.sin(time * 0.71 + d);
    const step = approach(on ? FOLLOW_RATE : REST_RATE, dt);
    antenna.swing += ((on ? amplitude * wanderSwing + side.twitch + side.lag : 0) - antenna.swing) * step;
    antenna.nod += ((on ? amplitude * 0.6 * wanderNod : 0) - antenna.nod) * step;
    antenna.ripple += ((on ? amplitude * 0.04 * (0.5 + nervousness) : 0) - antenna.ripple) * step;
    antenna.phase += dt * (2 + 6 * nervousness);
  }

  /**
   * @param {number} dt scaled seconds
   * @param {boolean} resting
   * @param {number} headSpeed yaw speed, radians per second
   */
  return function update(dt, resting, headSpeed) {
    time += dt * (0.6 + state.antennaNervousness);
    const on = state.antennaOn && !resting;
    const amplitude = state.antennaAmplitude * DEG * state.intensity;
    for (const side of sides) updateAntenna(side, on, amplitude, headSpeed, dt);
    const palps = state.palpsOn && !resting;
    pose.palps.left = advance(palpPulses.left, palps, PALP_TAP, dt);
    pose.palps.right = advance(palpPulses.right, palps, PALP_TAP, dt);
    pose.mandibles = advance(mandiblePulse, state.mandiblesOn && !resting, MANDIBLE_OPENING, dt);
  };
}
