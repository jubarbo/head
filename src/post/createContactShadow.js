// @ts-check
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { contactShadowFrame } from './contactShadowFrame.js';

const RESOLUTION = 512;
const DARKNESS = 0.85;
const OPACITY = 0.6;
const BLUR = 3.5;

/**
 * Soft contact shadow under the model: an orthographic camera on the floor looks up, renders depth
 * as "closer to the floor = darker", and the result is blurred onto a transparent plane.
 * The head is static, so the shadow is baked once per `bake()` call instead of every frame.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 */
export function createContactShadow(renderer, scene) {
  const target = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION);
  const blurTarget = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION);
  target.texture.generateMipmaps = blurTarget.texture.generateMipmaps = false;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, opacity: OPACITY, depthWrite: false }),
  );
  plane.name = 'contact-shadow';
  plane.renderOrder = -1;
  plane.visible = false;
  plane.userData.excludeFromAO = true;
  scene.add(plane);

  const camera = new THREE.OrthographicCamera();
  camera.up.set(0, 0, -1); // image up = world -Z, matching the plane's V axis

  const depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      `gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * ${DARKNESS.toFixed(2)} );`,
    );
  };

  const horizontal = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vertical = new THREE.ShaderMaterial(VerticalBlurShader);
  horizontal.depthTest = vertical.depthTest = false;
  const quad = new FullScreenQuad();

  /** @param {number} amount in texels */
  function blur(amount) {
    quad.material = horizontal;
    horizontal.uniforms.tDiffuse.value = target.texture;
    horizontal.uniforms.h.value = amount / RESOLUTION;
    renderer.setRenderTarget(blurTarget);
    quad.render(renderer);

    quad.material = vertical;
    vertical.uniforms.tDiffuse.value = blurTarget.texture;
    vertical.uniforms.v.value = amount / RESOLUTION;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }

  /**
   * Renders the shadow of `model` (already in the scene) and places the plane under it.
   * @param {THREE.Object3D} model
   */
  function bake(model) {
    const frame = contactShadowFrame(new THREE.Box3().setFromObject(model));
    plane.position.set(frame.center.x, frame.y, frame.center.z);
    plane.scale.set(frame.width, 1, frame.depth);

    // Left/right are swapped because a camera looking up sees world +X on its left.
    Object.assign(camera, {
      left: frame.width / 2, right: -frame.width / 2, top: frame.depth / 2, bottom: -frame.depth / 2,
      near: 0, far: frame.far,
    });
    camera.position.set(frame.center.x, frame.y, frame.center.z);
    camera.lookAt(frame.center.x, frame.y + 1, frame.center.z);
    camera.updateProjectionMatrix();

    const hidden = scene.children.filter((child) => child !== model && child.visible);
    for (const child of hidden) child.visible = false;
    const { background, overrideMaterial } = scene;
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    const shadowsEnabled = renderer.shadowMap.enabled;

    scene.background = null;
    scene.overrideMaterial = depthMaterial;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    blur(BLUR);
    blur(BLUR * 0.4); // second, finer pass removes the box-blur banding

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    renderer.shadowMap.enabled = shadowsEnabled;
    scene.background = background;
    scene.overrideMaterial = overrideMaterial;
    for (const child of hidden) child.visible = true;
    plane.visible = true;
  }

  return { plane, bake };
}
