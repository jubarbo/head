// @ts-check
import { Vector3 } from 'three';
import { createBehavior, gazeAngles } from './behavior.js';

const POINTER_IDLE = 3; // seconds without pointer movement before the mantis loses interest
const ATTENTION_DEPTH = 0.6; // fraction of the camera distance: looks at a point in front of the screen

/**
 * Connects the behavior to the viewer: reads the pointer, turns it into a gaze target and writes the
 * resulting pose on the head joint.
 * @param {{
 *   joints: Record<string, import('three').Group>,
 *   camera: import('three').PerspectiveCamera,
 *   reducedMotion: boolean,
 *   random?: () => number,
 * }} options
 */
export function createLife({ joints, camera, reducedMotion, random }) {
  const behavior = createBehavior(random, { alive: !reducedMotion });
  const pointer = new Vector3();
  const cameraPosition = new Vector3();
  const pivot = new Vector3();
  const point = new Vector3();
  let pointerIdle = Infinity;

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2, 0.5);
    pointerIdle = 0;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  function pointerTarget() {
    if (pointerIdle > POINTER_IDLE) return null;
    camera.getWorldPosition(cameraPosition);
    joints.head.getWorldPosition(pivot);
    point.copy(pointer).unproject(camera).sub(cameraPosition).normalize();
    point.multiplyScalar(cameraPosition.distanceTo(pivot) * ATTENTION_DEPTH).add(cameraPosition).sub(pivot);
    return gazeAngles(point.x, point.y, point.z);
  }

  return {
    behavior,

    /**
     * @param {number} delta
     * @param {boolean} paused true holds the rest pose
     */
    update(delta, paused) {
      pointerIdle += delta;
      const { yaw, pitch, roll } = behavior.update(delta, { target: pointerTarget(), paused });
      joints.head.rotation.set(-pitch, yaw, roll);
    },
  };
}
