// @ts-check
import { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } from 'three';
import CameraControls from 'camera-controls';
import { CAMERA_LIMITS, fitDistance, viewToLookAt } from './views.js';

CameraControls.install({ THREE: { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } });

const { ACTION } = CameraControls;
const PAN_MODIFIERS = ['Shift', 'Control', 'Meta'];

/** Normal lens vs. a narrow telephoto that approximates the orthographic reference views. */
const LENSES = Object.freeze({
  normal: { fov: 35, limits: CAMERA_LIMITS },
  telephoto: { fov: 6, limits: { ...CAMERA_LIMITS, minDistance: 20, maxDistance: 200 } },
});

/**
 * Orbit/zoom/pan with damping for mouse and touch, plus preset views and reset.
 * @param {import('three').PerspectiveCamera} camera
 * @param {HTMLElement} domElement
 */
export function createCameraRig(camera, domElement) {
  const controls = new CameraControls(camera, domElement);
  camera.far = 400;
  let lens = LENSES.normal;
  Object.assign(controls, {
    minDistance: lens.limits.minDistance,
    maxDistance: lens.limits.maxDistance,
    minPolarAngle: CAMERA_LIMITS.minPolarAngle,
    maxPolarAngle: CAMERA_LIMITS.maxPolarAngle,
    smoothTime: 0.25,
    draggingSmoothTime: 0.08,
    dollyToCursor: true,
  });

  const { min, max } = CAMERA_LIMITS.panBounds;
  controls.setBoundary(new Box3(new Vector3(min.x, min.y, min.z), new Vector3(max.x, max.y, max.z)));

  controls.mouseButtons.left = ACTION.ROTATE;
  controls.mouseButtons.right = ACTION.TRUCK;
  controls.mouseButtons.middle = ACTION.DOLLY;
  controls.mouseButtons.wheel = ACTION.DOLLY;
  controls.touches.one = ACTION.TOUCH_ROTATE;
  controls.touches.two = ACTION.TOUCH_DOLLY_TRUCK;
  controls.touches.three = ACTION.TOUCH_TRUCK;

  // Modifier + left drag pans, for trackpads and mice without a usable right button.
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    const panning = PAN_MODIFIERS.some((key) => event.getModifierState(key));
    controls.mouseButtons.left = panning ? ACTION.TRUCK : ACTION.ROTATE;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => { controls.mouseButtons.left = ACTION.ROTATE; });
  domElement.addEventListener('contextmenu', (event) => event.preventDefault());

  const origin = { x: 0, y: 0, z: 0 };

  /**
   * @param {string} name
   * @param {boolean} [animate]
   */
  function goToView(name, animate = true) {
    const distance = fitDistance(CAMERA_LIMITS.framingRadius, camera.fov, camera.aspect, lens.limits);
    const { position: p, target: t } = viewToLookAt(name, distance, origin);
    return controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, animate);
  }

  /**
   * Switches lens and re-frames the given view without a jump in apparent size.
   * @param {boolean} enabled
   * @param {string} view
   */
  function setTelephoto(enabled, view) {
    lens = enabled ? LENSES.telephoto : LENSES.normal;
    camera.fov = lens.fov;
    camera.updateProjectionMatrix();
    controls.minDistance = lens.limits.minDistance;
    controls.maxDistance = lens.limits.maxDistance;
    return goToView(view, false);
  }

  goToView('front', false);

  return {
    controls,
    goToView,
    setTelephoto,
    /** Front view framed for the current aspect ratio (a saved state would go stale on rotation). */
    reset: () => goToView('front'),
    /** @param {number} delta */
    update: (delta) => controls.update(delta),
  };
}
