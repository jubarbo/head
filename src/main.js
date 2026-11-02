// @ts-check
import { Timer } from 'three';
import { createStage } from './scene/createStage.js';
import { watchContext } from './scene/contextRecovery.js';
import { createCameraRig } from './controls/cameraRig.js';
import { createPlaceholderHead } from './model/placeholderHead.js';
import { loadHead } from './model/loadHead.js';
import { createReferenceOverlay } from './reference/referenceOverlay.js';
import { createQualityManager } from './quality/qualityManager.js';
import { createPost } from './post/createPost.js';
import { createContactShadow } from './post/createContactShadow.js';
import { bindPanel } from './ui/panel.js';
import { bindMaterialPanel } from './ui/materialPanel.js';
import { bindLoader } from './ui/loader.js';
import { bindLifePanel } from './ui/lifePanel.js';
import { createLife } from './behavior/lifeBinding.js';

const container = /** @type {HTMLElement} */ (document.getElementById('viewport'));
const loader = bindLoader();

try {
  start();
} catch (error) {
  console.error('Viewer failed to start', error);
  loader.fail('This device or browser cannot display WebGL 3D content.');
}

function start() {
  const stage = createStage(container);
  const post = createPost(stage.renderer, stage.scene, stage.camera);
  stage.onResize(post.setSize);
  const contactShadow = createContactShadow(stage.renderer, stage.scene);

  /** @type {import('three').Group | null} */
  let head = null;
  /** @type {ReturnType<typeof createLife> | null} */
  let life = null;
  const quality = createQualityManager({ ...stage, post }, (tier) => {
    container.dataset.tier = tier;
    head?.userData.setTextureTier?.(tier);
  });

  const headReady = loadHead(stage.renderer, quality.tier)
    .catch((error) => {
      console.error('Head model failed to load, showing the placeholder', error);
      return createPlaceholderHead();
    })
    .then((loaded) => {
      head = loaded;
      stage.scene.add(head);
      contactShadow.bake(head);
      if (head.userData.metal) bindMaterialPanel(head.userData.metal);
      if (head.userData.rig) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        life = createLife({ ...head.userData.rig, camera: stage.camera, reducedMotion });
        bindLifePanel(life.behavior);
        /** @type {any} */ (window).__mantis.life = life;
      }
      head.userData.setTextureTier?.(quality.tier); // auto mode may have moved while loading
      /** @type {any} */ (window).__mantis.head = head;
    });
  const environmentReady = stage.loadEnvironment().catch((error) => console.error('HDRI failed to load', error));

  const rig = createCameraRig(stage.camera, stage.renderer.domElement);
  const overlay = createReferenceOverlay(stage.scene);
  const panel = bindPanel(rig, overlay, quality);
  rig.controls.addEventListener('controlstart', panel.clearActiveView);
  frameAboveControls(stage, rig);
  rig.goToView('front', false); // re-fit now that the panel's height is known

  // Auto quality only samples once the scene is complete: downloads and shader compilation would
  // otherwise read as a slow device and drop the tier at startup.
  let sampling = false;
  Promise.all([headReady, environmentReady]).then(() => {
    requestAnimationFrame(() => {
      loader.done();
      sampling = true;
    });
  });

  watchContext(stage.renderer.domElement, {
    onLost() {
      sampling = false;
      loader.pause('Graphics context lost. Restoring…');
    },
    onRestored() {
      stage.rebuildEnvironment();
      if (head) contactShadow.bake(head);
      loader.resume();
      sampling = true;
    },
  });

  const timer = new Timer();
  timer.connect(document); // ignores time spent in a hidden tab
  stage.renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const delta = timer.getDelta();
    rig.update(delta);
    life?.update(delta, overlay.isVisible()); // the reference sheet is compared against the rest pose
    if (sampling) quality.sample(delta);
    panel.tick(delta, quality.tier);
    post.render(delta);
  });

  // Exposed for manual debugging and automated smoke checks.
  Object.assign(window, { __mantis: { stage, rig, quality, post, contactShadow } });
}

/**
 * Keeps the head framed in the area the overlays leave free, so the mouthparts are never hidden behind
 * the bottom control panel (it wraps to more rows on narrow screens). The material panel counts only
 * when it crosses the screen's centre line (portrait phones); elsewhere it sits beside the head.
 * Only viewport and control-panel resizes re-measure: opening "More" must not move the head.
 * @param {{ onResize: (listener: (width: number, height: number) => void) => void }} stage
 * @param {{ setViewport: (width: number, height: number, covered: { top: number, bottom: number }) => void }} rig
 */
function frameAboveControls(stage, rig) {
  const controls = /** @type {HTMLElement} */ (document.querySelector('.panel'));
  const material = /** @type {HTMLElement} */ (document.querySelector('[data-panel="material"]'));
  const MARGIN = 8; // px of breathing room between the head and a panel
  let size = { width: 1, height: 1 };
  const update = () => {
    const viewport = container.getBoundingClientRect();
    const bottom = viewport.bottom - controls.getBoundingClientRect().top + MARGIN;
    const side = material.getBoundingClientRect();
    const centre = viewport.left + viewport.width / 2;
    const top = side.left < centre && side.right > centre ? side.bottom - viewport.top + MARGIN : 0;
    rig.setViewport(size.width, size.height, { top, bottom });
  };
  stage.onResize((width, height) => {
    size = { width, height };
    update();
  });
  new ResizeObserver(update).observe(controls);
}
