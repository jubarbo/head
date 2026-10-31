// @ts-check
import { Timer } from 'three';
import { createStage } from './scene/createStage.js';
import { createCameraRig } from './controls/cameraRig.js';
import { createPlaceholderHead } from './model/placeholderHead.js';
import { loadHead } from './model/loadHead.js';
import { createReferenceOverlay } from './reference/referenceOverlay.js';
import { createQualityManager } from './quality/qualityManager.js';
import { createPost } from './post/createPost.js';
import { createContactShadow } from './post/createContactShadow.js';
import { QUALITY_TIERS, detectInitialTier } from './quality/tiers.js';
import { bindPanel } from './ui/panel.js';
import { bindMaterialPanel } from './ui/materialPanel.js';

const container = /** @type {HTMLElement} */ (document.getElementById('viewport'));

const startTier = detectInitialTier({
  isMobile: window.matchMedia('(pointer: coarse)').matches,
  hardwareConcurrency: navigator.hardwareConcurrency,
});
const stage = createStage(container, { antialias: QUALITY_TIERS[startTier].antialias });
const post = createPost(stage.renderer, stage.scene, stage.camera);
stage.onResize(post.setSize);
const contactShadow = createContactShadow(stage.renderer, stage.scene);

loadHead(stage.renderer, startTier)
  .catch((error) => {
    console.error('Head model failed to load, showing the placeholder', error);
    return createPlaceholderHead();
  })
  .then((head) => {
    stage.scene.add(head);
    contactShadow.bake(head);
    if (head.userData.metal) bindMaterialPanel(head.userData.metal);
    /** @type {any} */ (window).__mantis.head = head;
  });

const rig = createCameraRig(stage.camera, stage.renderer.domElement);
const quality = createQualityManager({ ...stage, post }, (tier) => { container.dataset.tier = tier; });
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
  post.render(delta);
});

// Exposed for manual debugging and automated smoke checks.
Object.assign(window, { __mantis: { stage, rig, quality, post, contactShadow } });
