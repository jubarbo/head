// @ts-check
import { Vector3 } from 'three';
import { antennaBoneRotation } from './appendages.js';
import { createBehavior, gazeAngles } from './behavior.js';

const POINTER_IDLE = 3; // seconds without pointer movement before the mantis loses interest
const ATTENTION_DEPTH = 0.6; // fraction of the camera distance: looks at a point in front of the screen
const DEG = Math.PI / 180;
const MANDIBLE_OPEN = 9 * DEG;
const PALP_SWING = 5 * DEG; // sideways, away from the midline
const PALP_LIFT = 7 * DEG; // forward, away from the face

/**
 * Connects the behavior to the viewer: reads the pointer, turns it into a gaze target and writes the
 * resulting pose on the head joint.
 * @param {{
 *   joints: Record<string, import('three').Group>,
 *   antennae: Record<string, import('three').Bone[]>,
 *   camera: import('three').PerspectiveCamera,
 *   reducedMotion: boolean,
 *   random?: () => number,
 * }} options
 */
export function createLife({ joints, antennae, camera, reducedMotion, random }) {
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

  /** @param {typeof behavior.pose} pose */
  function applyAppendages(pose) {
    const { intensity } = behavior.state;
    for (const [name, antenna] of [['antenna_l', pose.antennae.left], ['antenna_r', pose.antennae.right]]) {
      const bones = antennae[/** @type {string} */ (name)] ?? [];
      bones.forEach((bone, index) => {
        const { x, z } = antennaBoneRotation(/** @type {typeof pose.antennae.left} */ (antenna), index, bones.length);
        bone.rotation.set(x, 0, z);
      });
    }
    const opening = pose.mandibles * MANDIBLE_OPEN * intensity;
    joints.mandible_l?.rotation.set(0, 0, opening);
    joints.mandible_r?.rotation.set(0, 0, -opening);
    for (const [side, sign, value] of /** @type {const} */ ([['l', 1, pose.palps.left], ['r', -1, pose.palps.right]])) {
      for (const palp of [joints[`maxillary_palp_${side}`], joints[`labial_palp_${side}`]]) {
        palp?.rotation.set(-value * PALP_LIFT * intensity, 0, sign * value * PALP_SWING * intensity);
      }
    }
  }

  return {
    behavior,

    /**
     * @param {number} delta
     * @param {boolean} paused true holds the rest pose
     */
    update(delta, paused) {
      pointerIdle += delta;
      const pose = behavior.update(delta, { target: pointerTarget(), paused });
      joints.head.rotation.set(-pose.pitch, pose.yaw, pose.roll);
      applyAppendages(pose);
    },
  };
}
