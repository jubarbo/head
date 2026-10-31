// @ts-check

/**
 * Wires the HTML control panel to the camera rig, reference overlay and quality manager.
 * @param {{ goToView: (name: string) => unknown, reset: () => unknown, setTelephoto: (on: boolean, view: string) => unknown }} rig
 * @param {{ show: (view: string) => void, hide: () => void }} overlay
 * @param {{ setMode: (mode: any) => void }} quality
 */
export function bindPanel(rig, overlay, quality) {
  const viewButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-view]')]);
  const referenceButton = /** @type {HTMLButtonElement | null} */ (document.querySelector('[data-action="reference"]'));
  let activeView = /** @type {string | null} */ ('front');
  let referenceOn = false;

  const markActive = (/** @type {string | null} */ name) => {
    activeView = name;
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === name));
    if (referenceOn && name) overlay.show(name);
    else overlay.hide();
  };

  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      rig.goToView(/** @type {string} */ (button.dataset.view));
      markActive(button.dataset.view ?? null);
    });
  }

  document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    rig.reset();
    markActive('front');
  });

  referenceButton?.addEventListener('click', () => {
    referenceOn = !referenceOn;
    referenceButton.setAttribute('aria-pressed', String(referenceOn));
    const view = activeView ?? 'front';
    rig.setTelephoto(referenceOn, view);
    markActive(view);
  });

  const select = /** @type {HTMLSelectElement | null} */ (document.querySelector('[data-control="quality"]'));
  select?.addEventListener('change', () => quality.setMode(select.value));

  const fps = /** @type {HTMLOutputElement | null} */ (document.querySelector('[data-readout="fps"]'));
  let frames = 0;
  let elapsed = 0;

  markActive('front');

  return {
    /** Any manual orbit leaves the preset, so the highlight and the (now misaligned) overlay are cleared. */
    clearActiveView: () => markActive(null),
    /** @param {number} deltaSeconds */
    tick(deltaSeconds) {
      frames += 1;
      elapsed += deltaSeconds;
      if (elapsed >= 0.5 && fps) {
        fps.value = `${Math.round(frames / elapsed)} fps`;
        frames = 0;
        elapsed = 0;
      }
    },
  };
}
