// @ts-check
import { test, expect } from '@playwright/test';
import { openViewer, jumpTo } from './viewer.js';

const headRotation = (page) => page.evaluate(() => {
  const { x, y, z } = window.__mantis.head.userData.rig.joints.head.rotation;
  return { x, y, z };
});
const isAtRest = async (page) => {
  const { x, y, z } = await headRotation(page);
  return Math.hypot(x, y, z) < 0.01;
};

test.describe('with motion allowed', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('the head follows the pointer and rests again with Alive off', async ({ page }) => {
    await openViewer(page);
    await jumpTo(page, 'front');
    await page.locator('[data-panel="life"] summary').click();
    await page.locator('[data-setting="peeringOn"]').uncheck();
    const moveRight = setInterval(() => page.mouse.move(40, 300).catch(() => {}), 500);
    await expect.poll(async () => (await headRotation(page)).y, { timeout: 30_000 }).toBeLessThan(-0.1);
    clearInterval(moveRight);
    await page.locator('[data-setting="alive"]').uncheck();
    await expect.poll(() => isAtRest(page), { timeout: 30_000 }).toBe(true);
  });

  test('the reference overlay holds the rest pose', async ({ page }) => {
    await openViewer(page);
    await page.getByRole('button', { name: 'Reference' }).click();
    await page.mouse.move(40, 300);
    await expect.poll(() => isAtRest(page), { timeout: 30_000 }).toBe(true);
  });

  test('Reset defaults restores the panel', async ({ page }) => {
    await openViewer(page);
    await page.locator('[data-panel="life"] summary').click();
    const range = page.locator('[data-setting="range"]');
    await range.fill('10');
    expect(await page.evaluate(() => window.__mantis.life.behavior.state.range)).toBe(10);
    await page.getByRole('button', { name: 'Reset defaults' }).click();
    await expect(range).toHaveValue('30');
    expect(await page.evaluate(() => window.__mantis.life.behavior.state.range)).toBe(30);
  });
});

test('reduced motion starts with Alive off', async ({ page }) => {
  await openViewer(page);
  await page.locator('[data-panel="life"] summary').click();
  await expect(page.locator('[data-setting="alive"]')).not.toBeChecked();
  await page.mouse.move(40, 300);
  expect(await isAtRest(page)).toBe(true);
});
