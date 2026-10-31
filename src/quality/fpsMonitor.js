// @ts-check

/** Frames longer than this (hidden tab, breakpoint) are not representative and are skipped. */
const MAX_FRAME_SECONDS = 0.5;

/**
 * Averages frame times over a window and suggests a quality change.
 * @param {{ windowSeconds?: number, lowFps?: number, highFps?: number, cooldownSeconds?: number }} [options]
 */
export function createFpsMonitor({ windowSeconds = 2, lowFps = 28, highFps = 55, cooldownSeconds = 3 } = {}) {
  let elapsed = 0;
  let frames = 0;
  let cooldown = 0;

  return {
    /**
     * @param {number} deltaSeconds
     * @returns {'down' | 'up' | null}
     */
    push(deltaSeconds) {
      if (deltaSeconds <= 0 || deltaSeconds > MAX_FRAME_SECONDS) return null;
      if (cooldown > 0) {
        cooldown -= deltaSeconds;
        return null;
      }
      elapsed += deltaSeconds;
      frames += 1;
      if (elapsed < windowSeconds) return null;

      const fps = frames / elapsed;
      elapsed = 0;
      frames = 0;
      /** @type {'down' | 'up' | null} */
      const suggestion = fps < lowFps ? 'down' : fps > highFps ? 'up' : null;
      if (suggestion) cooldown = cooldownSeconds;
      return suggestion;
    },
    reset() {
      elapsed = 0;
      frames = 0;
      cooldown = 0;
    },
  };
}
