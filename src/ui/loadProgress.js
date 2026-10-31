// @ts-check

/** Share of the bar left for the work after the last download (material setup, first frame). */
const READY_SHARE = 0.05;

/**
 * Loading bar value from three's LoadingManager counts. The total grows as loaders discover files
 * (KTX2 transcoder, textures), so the ratio is kept monotonic; it only reaches 1 on `finish()`.
 */
export function createLoadProgress() {
  let value = 0;
  return {
    /** @param {number} loaded @param {number} total @returns {number} 0..1 */
    update(loaded, total) {
      if (total > 0) value = Math.max(value, Math.min(loaded / total, 1 - READY_SHARE));
      return value;
    },
    finish() {
      value = 1;
      return value;
    },
  };
}
