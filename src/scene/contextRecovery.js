// @ts-check

/**
 * Watches the canvas for WebGL context loss (GPU reset, mobile tab eviction). The loss is cancelled so
 * the browser may restore the context; three then re-uploads textures, geometry and programs itself,
 * and `onRestored` rebuilds what only lived on the GPU (render-target contents such as the PMREM
 * environment and the baked contact shadow).
 * @param {HTMLCanvasElement} canvas
 * @param {{ onLost: () => void, onRestored: () => void }} handlers
 */
export function watchContext(canvas, { onLost, onRestored }) {
  let lost = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    onLost();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!lost) return;
    lost = false;
    onRestored();
  });
}
