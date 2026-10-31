// @ts-check
// Reference implementations of the eye shader's view-dependent terms (eyeMaterial.js mirrors them in GLSL).

/**
 * Angular radius of the pseudopupil: the facets whose axes point at the viewer within this cone look
 * dark because their pigment absorbs the light, so the spot follows the camera like on the real insect.
 * On the ellipsoidal eye a fixed angle covers more surface along the long axis, which makes it oval.
 */
export const PSEUDOPUPIL = Object.freeze({ innerDeg: 5, outerDeg: 10 });

/** Facet diameter in model units (cm): ~65 facets across the 1.4 cm wide eye, as in the reference. */
export const OMMATIDIUM_SIZE = 0.022;

/** Screen footprint (facets per pixel) where the facet pattern starts and finishes fading out. */
export const OMMATIDIA_FADE = Object.freeze({ start: 0.2, end: 0.45 });

/** @param {number} edge0 @param {number} edge1 @param {number} x */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
