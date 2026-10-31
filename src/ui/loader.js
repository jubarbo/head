// @ts-check
import { DefaultLoadingManager } from 'three';
import { createLoadProgress } from './loadProgress.js';

/**
 * Full-screen status overlay (index.html `[data-loader]`): download progress from three's default
 * LoadingManager until `done()`, then reused for a lost graphics context or a fatal error.
 */
export function bindLoader() {
  const element = /** @type {HTMLElement} */ (document.querySelector('[data-loader]'));
  const message = /** @type {HTMLElement} */ (element.querySelector('[data-loader-message]'));
  const progress = createLoadProgress();
  let loading = true;

  /** @param {number} value 0..1 */
  const setBar = (value) => {
    element.style.setProperty('--progress', String(value));
    message.textContent = value < 1 ? `Loading… ${Math.round(value * 100)}%` : 'Ready';
  };

  DefaultLoadingManager.onProgress = (_url, loaded, total) => {
    if (loading) setBar(progress.update(loaded, total)); // later tier texture swaps stay silent
  };

  /**
   * @param {'loading' | 'done' | 'paused' | 'error'} state
   * @param {string} [text]
   */
  const show = (state, text) => {
    element.dataset.state = state;
    if (text) message.textContent = text;
  };

  return {
    done() {
      loading = false;
      setBar(progress.finish());
      show('done');
    },
    /** @param {string} text */
    pause(text) { show('paused', text); },
    resume() { show('done'); },
    /** @param {string} text */
    fail(text) {
      loading = false;
      show('error', text);
    },
  };
}
