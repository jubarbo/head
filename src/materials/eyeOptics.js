// @ts-check
// Reference implementations of the eye shader's view-dependent terms (eyeMaterial.js mirrors them in GLSL).

/**
 * Angular radius of the pseudopupil: the facets whose axes point at the viewer within this cone look
 * dark because their pigment absorbs the light, so the spot follows the camera like on the real insect.
 * On the ellipsoidal eye a fixed angle covers more surface along the long axis, which makes it oval.
 */
export const PSEUDOPUPIL = Object.freeze({
  innerDeg: 7,
  outerDeg: 13,
  /** How far the spot leans from the view direction toward `lateral`: the guide shows it near the outer side. */
  lateralBias: 0.55,
  /** Outer side of the left eye in its object space (x is mirrored on the right eye), slightly forward. */
  lateral: Object.freeze([1, -0.12, 0.35]),
});

/**
 * Facet diameter in the eye's quantized object space (1 unit = 0.92 cm). The real eye has about twice as
 * many facets, but they would stay under 2 px at the default distance; ~35 across the eye keeps them visible.
 */
export const OMMATIDIUM_SIZE = 0.04;

/** Screen footprint (facets per pixel) where the facet pattern starts and finishes fading out. */
export const OMMATIDIA_FADE = Object.freeze({ start: 0.2, end: 0.45 });

/** @param {number} edge0 @param {number} edge1 @param {number} x */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Direction whose facets show the pseudopupil: between the viewer and the outer side of the eye, so the
 * spot still moves with the view but sits where the reference sheet shows it.
 * @param {readonly number[]} view unit vector from the eye toward the camera
 * @param {readonly number[]} lateral outer side of this eye
 * @returns {number[]} unit vector
 */
export function pseudopupilAxis(view, lateral) {
  const k = PSEUDOPUPIL.lateralBias;
  const length = Math.hypot(...lateral);
  const axis = view.map((v, i) => v * (1 - k) + (lateral[i] / length) * k);
  const norm = Math.hypot(...axis);
  return axis.map((v) => v / norm);
}

/**
 * Darkening of the eye surface from the cosine between its normal and the view direction.
 * @param {number} nDotV
 * @returns {number} 1 inside the pseudopupil, 0 outside
 */
export function pseudopupilFactor(nDotV) {
  const rad = Math.PI / 180;
  return smoothstep(Math.cos(PSEUDOPUPIL.outerDeg * rad), Math.cos(PSEUDOPUPIL.innerDeg * rad), nDotV);
}

/**
 * How much of the facet pattern to keep for a given screen footprint. Below ~2 px per facet the
 * pattern would alias into moiré, so it fades to its average color (the shader uses fwidth()).
 * @param {number} facetsPerPixel
 * @returns {number}
 */
export function ommatidiaVisibility(facetsPerPixel) {
  return 1 - smoothstep(OMMATIDIA_FADE.start, OMMATIDIA_FADE.end, facetsPerPixel);
}
