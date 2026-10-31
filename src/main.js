// @ts-check
import { Timer } from 'three';
import { createStage } from './scene/createStage.js';
import { createCameraRig } from './controls/cameraRig.js';
import { createPlaceholderHead } from './model/placeholderHead.js';
import { loadHead } from './model/loadHead.js';
import { createReferenceOverlay } from './reference/referenceOverlay.js';
import { createQualityManager } from './quality/qualityManager.js';
import { QUALITY_TIERS, detectInitialTier } from './quality/tiers.js';
import { bindPanel } from './ui/panel.js';

const container = /** @type {HTMLElement} */ (document.getElementById('viewport'));

const startTier = detectInitialTier({
  isMobile: window.matchMedia('(pointer: coarse)').matches,
  hardwareConcurrency: navigator.hardwareConcurrency,
});
const stage = createStage(container, { antialias: QUALITY_TIERS[startTier].antialias });
loadHead(stage.renderer, startTier)
  .then((head) => stage.scene.add(head))
  .catch((error) => {
    console.error('Head model failed to load, showing the placeholder', error);
    stage.scene.add(createPlaceholderHead());
  });

const rig = createCameraRig(stage.camera, stage.renderer.domElement);
const quality = createQualityManager(stage, (tier) => { container.dataset.tier = tier; });
const overlay = createReferenceOverlay(stage.scene);
const panel = bindPanel(rig, overlay, quality);
rig.controls.addEventListener('controlstart', panel.clearActiveView);

stage.loadEnvironment().catch((error) => console.error('HDRI failed to load', error));

const timer = new Timer();
timer.connect(document); // ignores time spent in a hidden tab
stage.renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  rig.update(delta);
  quality.sample(delta);
  panel.tick(delta);
  stage.renderer.render(stage.scene, stage.camera);
});

// Exposed for manual debugging and automated smoke checks.
Object.assign(window, { __mantis: { stage, rig, quality } });
