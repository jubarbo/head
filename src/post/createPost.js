// @ts-check
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { passOrder } from './passOrder.js';

/** GTAO in scene units (1 u = 1 cm): reaches into the eye/gena and mandible/palp creases only. */
const AO_PARAMETERS = { radius: 0.3, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 16 };
/** Bloom only catches the HDR wet highlights on the eyes and ocelli (linear values above 2): lower thresholds haloed the eye rims. */
const BLOOM = { strength: 0.12, radius: 0.35, threshold: 2 };

/**
 * GTAO that skips helper surfaces flagged `userData.excludeFromAO` (contact shadow, reference
 * overlays): they are transparent, so their depth would paint false occlusion on the backdrop.
 */
class HeadAOPass extends GTAOPass {
  /** @param {Parameters<GTAOPass['render']>} args */
  render(...args) {
    /** @type {THREE.Object3D[]} */
    const hidden = [];
    this.scene.traverseVisible((object) => { if (object.userData.excludeFromAO) hidden.push(object); });
    for (const object of hidden) object.visible = false;
    super.render(...args);
    for (const object of hidden) object.visible = true;
  }
}

/**
 * Post-processing chain (three's own addons): render → GTAO → bloom → AgX output → SMAA.
 * Passes are created once and only re-linked when the quality tier changes.
 * @param {THREE.WebGLRenderer} renderer tone mapping and color space are read by OutputPass
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 */
export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const size = renderer.getSize(new THREE.Vector2());

  const gtao = new HeadAOPass(scene, camera, size.x, size.y, undefined, AO_PARAMETERS);
  gtao.blendIntensity = 0.85;
  const passes = {
    render: new RenderPass(scene, camera),
    gtao,
    bloom: new UnrealBloomPass(size, BLOOM.strength, BLOOM.radius, BLOOM.threshold),
    output: new OutputPass(),
    smaa: new SMAAPass(),
  };

  /** @param {import('../quality/tiers.js').TierSettings} settings */
  function setTier(settings) {
    for (const pass of [...composer.passes]) composer.removePass(pass);
    for (const name of passOrder(settings)) composer.addPass(passes[name]);
    composer.setPixelRatio(renderer.getPixelRatio());
  }

  return {
    composer,
    setTier,
    /** @param {number} width @param {number} height CSS pixels */
    setSize(width, height) { composer.setSize(width, height); },
    /** @param {number} deltaSeconds */
    render(deltaSeconds) { composer.render(deltaSeconds); },
  };
}
