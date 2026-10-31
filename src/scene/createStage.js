// @ts-check
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const BACKGROUND = 0x1b1a19;
const HDRI_URL = `${import.meta.env.BASE_URL}hdri/studio_small_09_1k.hdr`;

/**
 * Renderer, scene, camera and studio lighting. The floor shadow is the baked contact shadow
 * (src/post/createContactShadow.js); the key light's shadow map only self-shadows the head.
 * Tone mapping is applied by the composer's OutputPass, which reads `renderer.toneMapping`.
 * Antialiasing is SMAA in the composer; the canvas is only its final target, so MSAA is off.
 * @param {HTMLElement} container
 */
export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.6);
  keyLight.position.set(4, 6, 6);
  keyLight.castShadow = true;
  keyLight.shadow.radius = 6;
  keyLight.shadow.bias = -0.0005;
  Object.assign(keyLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });

  const rimLight = new THREE.DirectionalLight(0xdfe8ff, 0.8);
  rimLight.position.set(-5, 3, -6);
  scene.add(keyLight, rimLight);

  /** @type {THREE.DataTexture | null} kept on the CPU to rebuild the PMREM after a context loss */
  let hdr = null;
  /** @type {THREE.WebGLRenderTarget | null} */
  let environmentTarget = null;
  /** Loads the HDRI as image-based lighting only; the backdrop stays the flat studio gray. */
  async function loadEnvironment() {
    hdr = await new HDRLoader().loadAsync(HDRI_URL);
    buildEnvironment();
  }
  /** @param {{ contextLost?: boolean }} [options] after a context loss the old target died with the context */
  function buildEnvironment({ contextLost = false } = {}) {
    if (!hdr) return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (!contextLost) environmentTarget?.dispose();
    environmentTarget = pmrem.fromEquirectangular(hdr);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.9;
    hdr.dispose(); // GPU copy only; the pixel data stays in hdr.image
    pmrem.dispose();
  }

  /** @type {((width: number, height: number) => void)[]} */
  const resizeListeners = [];
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const listener of resizeListeners) listener(w, h);
  }
  /** @param {(width: number, height: number) => void} listener called now and on every resize */
  function onResize(listener) {
    resizeListeners.push(listener);
    const { width, height } = renderer.getSize(new THREE.Vector2());
    listener(width, height);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return { renderer, scene, camera, keyLight, loadEnvironment, rebuildEnvironment: () => buildEnvironment({ contextLost: true }), onResize };
}
