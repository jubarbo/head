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

// S5 / T9d: the first load stays under budget with every living effect shipped.
test('keeps the first load under 6 MB', async ({ page }) => {
  /** @type {Promise<number>[]} */
  const sizes = [];
  page.on('response', (response) => {
    if (response.url().startsWith('http') && response.ok()) sizes.push(response.body().then((body) => body.length));
  });
  await openViewer(page);
  const total = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
  expect(total).toBeGreaterThan(1_000_000); // guards against an empty measurement
  expect(total).toBeLessThan(6_000_000);
});
