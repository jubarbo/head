// @ts-check

/**
 * Wires the material panel (skin → metal slider, finishes and the extra controls) to the head's
 * metal controls, and enables it once the model is loaded (the placeholder has none).
 * @param {import('../materials/metalTransition.js').MetalControls} metal
 */
export function bindMaterialPanel(metal) {
  const panel = /** @type {HTMLElement | null} */ (document.querySelector('[data-panel="material"]'));
  if (!panel) return;
  const input = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (panel.querySelector(`[data-control="${name}"]`));
  const presetButtons = /** @type {HTMLButtonElement[]} */ ([...panel.querySelectorAll('[data-preset]')]);

  /** Mirrors the controls' state, since a preset resets the tone and roughness sliders. */
  const sync = () => {
    input('metal-progress').value = String(metal.state.progress);
    input('metal-roughness').value = String(metal.state.roughness);
    input('relief').value = String(metal.state.relief);
    input('metal-hue').value = String(metal.state.hue);
    input('eye-iridescence').value = String(metal.state.eyeIridescence);
    for (const button of presetButtons) button.setAttribute('aria-pressed', String(button.dataset.preset === metal.state.preset));
  };

  /** @type {Array<[string, (value: number) => void]>} */
  const sliders = [
    ['metal-progress', metal.setProgress],
    ['metal-roughness', metal.setRoughness],
    ['relief', metal.setRelief],
    ['metal-hue', metal.setHue],
    ['eye-iridescence', metal.setEyeIridescence],
  ];
  for (const [name, set] of sliders) {
    input(name).addEventListener('input', (event) => set(Number(/** @type {HTMLInputElement} */ (event.target).value)));
  }
  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      metal.setPreset(/** @type {string} */ (button.dataset.preset));
      sync();
    });
  }

  for (const control of panel.querySelectorAll('input, button')) /** @type {HTMLInputElement} */ (control).disabled = false;
  panel.dataset.ready = 'true';
  sync();
}
