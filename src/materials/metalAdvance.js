// @ts-check
// Reference implementation of the skin → metal advance mask (metalTransition.js mirrors it in GLSL).
import { Vector3 } from 'three';
import { smoothstep } from './eyeOptics.js';

/** Width of the soft front, in field units (0 at the mandibles, 1 at the farthest point). */
export const ADVANCE_EDGE_WIDTH = 0.03; // ~0.2 cm on the capsule: a crisp dissolve, not a fog

/**
 * How metallic a surface point is for a slider value. `field` is the point's arrival time: distance
 * from the mouth plus noise, normalized to 0..1. The edge is stretched by its width so that 0 is fully
 * organic and 1 fully metallic everywhere, and it only moves forward as the slider grows.
 * @param {number} progress slider value, 0..1
 * @param {number} field 0..1
 * @param {number} [width]
 */
export function metalCoverage(progress, field, width = ADVANCE_EDGE_WIDTH) {
  const edge = progress * (1 + width);
  return 1 - smoothstep(edge - width, edge, field);
}

/**
 * Thin band on the advancing front: peaks where the coverage is half, zero on settled skin or metal.
 * @param {number} coverage
 */
export function frontEdge(coverage) {
  return 4 * coverage * (1 - coverage);
}

/**
 * Where the advance starts (the mouth) and how far it must travel to cover the whole head.
 * @param {import('three').Box3} box world bounds of the head
 * @param {Vector3} mouth world point between the mandible tips
 * @returns {{ origin: Vector3, reach: number }}
 */
export function advanceFrame(box, mouth) {
  let reach = 0;
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    reach = Math.max(reach, corner.distanceTo(mouth));
  }
  return { origin: mouth.clone(), reach };
}
