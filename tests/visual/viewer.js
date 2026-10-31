// @ts-check
import { expect } from '@playwright/test';

/**
 * Opens the built viewer, records console errors and failed requests, and waits until the head,
 * HDRI and maps are loaded. Quality is pinned to a manual tier so Auto cannot change the frame.
 * @param {import('@playwright/test').Page} page
 * @param {'low' | 'medium' | 'high'} [tier]
 */
export async function openViewer(page, tier = 'high') {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`failed: ${request.url()}`));
  page.on('response', (response) => {
    requests.push(response.url());
    if (response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`);
  });

  await page.goto('./');
  await expect(page.locator('[data-loader]')).toHaveAttribute('data-state', 'done');
  await page.locator('[data-control="quality"]').selectOption(tier);
  await expect(page.locator('#viewport')).toHaveAttribute('data-tier', tier);
  await expect(page.locator('[data-panel="material"]')).toHaveAttribute('data-ready', 'true');
  return { problems, requests };
}

/**
 * Jumps to a reference view without the animated transition, so the next frame is final.
 * @param {import('@playwright/test').Page} page
 * @param {string} view
 */
export async function jumpTo(page, view) {
  await page.evaluate((name) => /** @type {any} */ (window).__mantis.rig.goToView(name, false), view);
}

/** The fps readout changes every half second; it is masked out of snapshots. */
export const unstable = (/** @type {import('@playwright/test').Page} */ page) => [page.locator('[data-readout="fps"]')];
