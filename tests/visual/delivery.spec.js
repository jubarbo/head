// @ts-check
import { test, expect } from '@playwright/test';
import { openViewer } from './viewer.js';

// T7 acceptance: the build served under a Pages subpath loads every asset without errors.
test('loads the build under a subpath with every asset and no errors', async ({ page }) => {
  const { problems, requests } = await openViewer(page);

  const loaded = (/** @type {RegExp} */ pattern) => requests.some((url) => pattern.test(url));
  expect(loaded(/\/mantis\/models\/mantis-head\.glb$/)).toBe(true);
  expect(loaded(/\/mantis\/hdri\/[^/]+\.hdr$/)).toBe(true);
  expect(loaded(/\/mantis\/textures\/[^/]+\.ktx2$/)).toBe(true);
  expect(loaded(/\/mantis\/assets\/basis_transcoder[^/]*\.wasm$/)).toBe(true);
  // Nothing may escape the subpath (an absolute /asset URL would 404 on Pages); data:/blob: URLs are in-memory.
  const network = requests.filter((url) => url.startsWith('http'));
  expect(network.filter((url) => !new URL(url).pathname.startsWith('/mantis/'))).toEqual([]);

  // The real model, not the placeholder fallback, with its metal controls.
  expect(await page.evaluate(() => Boolean(/** @type {any} */ (window).__mantis.head.userData.metal))).toBe(true);
  expect(problems).toEqual([]);
});
