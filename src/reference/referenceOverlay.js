// @ts-check
import { DoubleSide, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import calibration from '../../assets-src/reference/calibration.json';
import { planeBasis, planeLayout } from './calibration.js';

const OPACITY = 0.5;

/**
 * Semi-transparent reference images, one plane per preset view, drawn on top of the model.
 * Planes pass through the orbit target; with the telephoto camera the parallax is negligible.
 * @param {import('three').Scene} scene
 */
export function createReferenceOverlay(scene) {
  const loader = new TextureLoader();
  /** @type {Map<string, Mesh>} */
  const planes = new Map();

  /** @param {string} view */
  function planeFor(view) {
    const existing = planes.get(view);
    if (existing) return existing;
    const settings = /** @type {Record<string, any>} */ (calibration.views)[view];
    if (!settings) return null;

    const { width, height, centerU, centerV } = planeLayout(settings);
    const { u, v, normal } = planeBasis(settings.axes);
    const texture = loader.load(`${import.meta.env.BASE_URL}reference/${view}.webp`);
    texture.colorSpace = SRGBColorSpace;

    const plane = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: texture, transparent: true, opacity: OPACITY, depthTest: false, depthWrite: false, side: DoubleSide, toneMapped: false }),
    );
    const U = new Vector3(...u);
    const V = new Vector3(...v);
    plane.matrixAutoUpdate = false;
    plane.matrix.copy(new Matrix4().makeBasis(U, V, new Vector3(...normal)).setPosition(U.multiplyScalar(centerU).add(V.multiplyScalar(centerV))));
    plane.renderOrder = 1000;
    plane.name = `reference-${view}`;
    plane.visible = false;
    scene.add(plane);
    planes.set(view, plane);
    return plane;
  }

  return {
    /** @param {string} view */
    show(view) {
      for (const plane of planes.values()) plane.visible = false;
      const plane = planeFor(view);
      if (plane) plane.visible = true;
    },
    hide() {
      for (const plane of planes.values()) plane.visible = false;
    },
  };
}
