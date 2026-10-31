// @ts-check
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const BACKGROUND = 0x1b1a19;
const HDRI_URL = `${import.meta.env.BASE_URL}hdri/studio_small_09_1k.hdr`;

/**
 * Renderer, scene, camera, studio lighting and a shadow catcher.
 * @param {HTMLElement} container
 * @param {{ antialias: boolean }} options
 */
export function createStage(container, { antialias }) {
  const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
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

  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -2.6;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  /** Loads the HDRI as image-based lighting only; the backdrop stays the flat studio gray. */
  async function loadEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const hdr = await new HDRLoader().loadAsync(HDRI_URL);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentIntensity = 0.9;
    hdr.dispose();
    pmrem.dispose();
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return { renderer, scene, camera, keyLight, loadEnvironment };
}
