// @ts-check

/**
 * Wires the Life panel to the behavior settings, and enables it once the model is loaded (the
 * placeholder has no joints). Settings apply live; Reset restores the defaults.
 * @param {ReturnType<typeof import('../behavior/behavior.js').createBehavior>} behavior
 */
export function bindLifePanel(behavior) {
  const panel = /** @type {HTMLElement | null} */ (document.querySelector('[data-panel="life"]'));
  if (!panel) return;
  const inputs = /** @type {HTMLInputElement[]} */ ([...panel.querySelectorAll('[data-setting]')]);
  const keyOf = (/** @type {HTMLInputElement} */ input) => /** @type {keyof typeof behavior.state} */ (input.dataset.setting);

  /** Mirrors the settings, since Reset changes them all. */
  const sync = () => {
    for (const input of inputs) {
      const value = behavior.state[keyOf(input)];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
  };

  for (const input of inputs) {
    input.addEventListener('input', () => {
      behavior.set({ [keyOf(input)]: input.type === 'checkbox' ? input.checked : Number(input.value) });
    });
  }
  panel.querySelector('[data-action="life-reset"]')?.addEventListener('click', () => {
    behavior.reset();
    sync();
  });

  for (const control of panel.querySelectorAll('input, button')) /** @type {HTMLInputElement} */ (control).disabled = false;
  panel.dataset.ready = 'true';
  sync();
}
