// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Visual and delivery checks against the production build, served under a GitHub Pages-like
// subpath (/mantis/) so relative asset and transcoder URLs are exercised as they are on Pages.
const port = 4180;
const base = '/mantis/';

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.spec.js',
  // Headless browsers render WebGL on the CPU (SwiftShader): a High-tier frame takes about a second.
  timeout: 180_000,
  expect: { timeout: 60_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 } },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__snapshots__/{projectName}/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${port}${base}`,
    contextOptions: { reducedMotion: 'reduce' }, // the head stays at rest, so snapshots are deterministic
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 },
    },
    {
      // WebKit engine with iPhone viewport, touch and UA: the closest local stand-in for Safari on iOS.
      // Needs `npx playwright install-deps webkit` once (system libraries, requires sudo).
      name: 'iphone-webkit',
      use: { ...devices['iPhone 13'], launchOptions: {} },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --base ${base} --port ${port} --strictPort`,
    url: `http://localhost:${port}${base}`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
