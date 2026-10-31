// @ts-check

/** Small angle that keeps the camera off the exact pole so its up vector stays defined. */
const POLE_EPSILON = 1e-3;

/** Scene scale: 1 unit = 1 cm, the head is ~3.5 units tall. */
export const CAMERA_LIMITS = Object.freeze({
  defaultDistance: 10,
  minDistance: 4,
  maxDistance: 25,
  minPolarAngle: POLE_EPSILON,
  maxPolarAngle: Math.PI - POLE_EPSILON,
  /** Radius that encloses the head and eyes (antennae may leave the frame). */
  framingRadius: 2.6,
  /** The orbit target may only be panned inside this box, so the head cannot be lost. */
  panBounds: Object.freeze({
    min: Object.freeze({ x: -3, y: -3, z: -3 }),
    max: Object.freeze({ x: 3, y: 3, z: 3 }),
  }),
});

/**
 * Preset views from the reference sheet, as spherical angles around the target.
 * The head faces +Z, so its right side is at -X.
 * @type {Readonly<Record<string, { azimuth: number, polar: number }>>}
 */
const VIEWS = Object.freeze({
  front: { azimuth: 0, polar: Math.PI / 2 },
  right: { azimuth: -Math.PI / 2, polar: Math.PI / 2 },
  top: { azimuth: 0, polar: POLE_EPSILON },
  // The guide's bottom view is shot from below and in front; straight below, the neck hides the mouth.
  bottom: { azimuth: 0, polar: Math.PI - 0.5 },
});

export const VIEW_NAMES = Object.freeze(Object.keys(VIEWS));

/**
 * @typedef {{ x: number, y: number, z: number }} Vec3
 * @param {string} name
 * @param {number} distance
 * @param {Vec3} target
 * @returns {{ position: Vec3, target: Vec3, azimuth: number, polar: number, distance: number }}
 */
export function viewToLookAt(name, distance, target) {
  const view = VIEWS[name];
  if (!view) throw new Error(`Unknown view: ${name}`);
  const { azimuth, polar } = view;
  const sinPolar = Math.sin(polar);
  return {
    position: {
      x: target.x + distance * sinPolar * Math.sin(azimuth),
      y: target.y + distance * Math.cos(polar),
      z: target.z + distance * sinPolar * Math.cos(azimuth),
    },
    target: { ...target },
    azimuth,
    polar,
    distance,
  };
}

/**
 * Distance at which a sphere fits both the vertical and the horizontal field of view,
 * so portrait phones back the camera off instead of cutting the eyes.
 * @param {number} radius
 * @param {number} verticalFovDeg
 * @param {number} aspect width / height
 * @param {{ minDistance: number, maxDistance: number }} [limits]
 */
export function fitDistance(radius, verticalFovDeg, aspect, limits = CAMERA_LIMITS) {
  const halfV = (verticalFovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const distance = radius / Math.sin(Math.min(halfV, halfH));
  return Math.min(limits.maxDistance, Math.max(limits.minDistance, distance));
}
