// @ts-check

const MARGIN = 0.8; // soft penumbra spreads past the footprint
const GAP = 0.04; // keeps the plane off the model's lowest vertices

/**
 * Where the contact shadow plane goes and what its upward-looking depth camera must capture.
 * @param {import('three').Box3} box world-space bounds of the model
 */
export function contactShadowFrame(box) {
  return {
    y: box.min.y - GAP,
    center: { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 },
    width: box.max.x - box.min.x + 2 * MARGIN,
    depth: box.max.z - box.min.z + 2 * MARGIN,
    far: box.max.y - box.min.y + GAP,
  };
}
