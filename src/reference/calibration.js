// @ts-check

/**
 * @typedef {{ crop: number[], originPx: number[], originUV: number[], unitsPerPx: number, axes: { u: string, v: string } }} ViewCalibration
 * @typedef {[number, number, number]} Axis
 */

/** @type {Record<string, Axis>} */
const AXES = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/**
 * Image pixel (relative to the crop, y down) → plane coordinates in world units (v up).
 * @param {ViewCalibration} view
 * @param {number} px
 * @param {number} py
 */
export function pixelToPlane(view, px, py) {
  const [ox, oy] = view.originPx;
  const [u0, v0] = view.originUV;
  return {
    u: u0 + (px - ox) * view.unitsPerPx,
    v: v0 + (oy - py) * view.unitsPerPx,
  };
}

/**
 * Size of the reference plane and its center in plane coordinates.
 * @param {ViewCalibration} view
 */
export function planeLayout(view) {
  const [x0, y0, x1, y1] = view.crop;
  const widthPx = x1 - x0;
  const heightPx = y1 - y0;
  const center = pixelToPlane(view, widthPx / 2, heightPx / 2);
  return {
    width: widthPx * view.unitsPerPx,
    height: heightPx * view.unitsPerPx,
    centerU: center.u,
    centerV: center.v,
  };
}

/**
 * World axes for the plane's u (image right) and v (image up); normal = u × v points at the viewer.
 * @param {{ u: string, v: string }} axes
 */
export function planeBasis({ u, v }) {
  const uAxis = AXES[u];
  const vAxis = AXES[v];
  if (!uAxis || !vAxis) throw new Error(`Unknown axis: ${uAxis ? v : u}`);
  /** @type {Axis} */
  const normal = [
    uAxis[1] * vAxis[2] - uAxis[2] * vAxis[1],
    uAxis[2] * vAxis[0] - uAxis[0] * vAxis[2],
    uAxis[0] * vAxis[1] - uAxis[1] * vAxis[0],
  ];
  return { u: uAxis, v: vAxis, normal };
}
