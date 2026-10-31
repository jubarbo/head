// @ts-check

/**
 * Wires the HTML control panel to the camera rig and quality manager.
 * @param {{ goToView: (name: string) => unknown, reset: () => unknown }} rig
 * @param {{ setMode: (mode: any) => void }} quality
 */
export function bindPanel(rig, quality) {
  const viewButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-view]')]);
  const markActive = (/** @type {string | null} */ name) => {
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === name));
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

  const select = /** @type {HTMLSelectElement | null} */ (document.querySelector('[data-control="quality"]'));
  select?.addEventListener('change', () => quality.setMode(select.value));

  const fps = /** @type {HTMLOutputElement | null} */ (document.querySelector('[data-readout="fps"]'));
  let frames = 0;
  let elapsed = 0;

  markActive('front');

  return {
    /** Any manual orbit leaves the preset, so the highlight is cleared. */
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
