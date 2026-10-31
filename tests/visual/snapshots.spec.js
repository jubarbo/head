// @ts-check
import { test, expect } from '@playwright/test';
import { openViewer, jumpTo, unstable } from './viewer.js';

for (const view of ['front', 'right', 'top', 'bottom']) {
  test(`skin, ${view} view`, async ({ page }) => {
    await openViewer(page);
    await jumpTo(page, view);
    await expect(page).toHaveScreenshot(`skin-${view}.png`, { mask: unstable(page) });
  });
}

test('gold halfway through the transition', async ({ page }) => {
  await openViewer(page);
  await page.getByRole('button', { name: 'Gold' }).click();
  await page.locator('[data-control="metal-progress"]').fill('0.5');
  await expect(page).toHaveScreenshot('metal-gold-0.5.png', { mask: unstable(page) });
});

test('full chrome', async ({ page }) => {
  await openViewer(page);
  await page.getByRole('button', { name: 'Chrome' }).click();
  await page.locator('[data-control="metal-progress"]').fill('1');
  await expect(page).toHaveScreenshot('metal-chrome-1.png', { mask: unstable(page) });
});

test('low tier renders without screen-space effects', async ({ page }) => {
  await openViewer(page, 'low');
  await expect(page).toHaveScreenshot('skin-front-low.png', { mask: unstable(page) });
});
