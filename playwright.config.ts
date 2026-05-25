import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // On CI, run E2E across ~half the runner's cores. The field-stress tests do
  // heavy in-process decode (sharp + wasm engines), so 50% balances speed
  // against CPU contention; the retries above absorb any contention flakes.
  ...(process.env['CI'] ? { workers: '50%' } : {}),
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    headless: true,
  },
  // chromium runs the full suite (the dev default). firefox + webkit run only
  // the canvas-path tests via `grep` — every PNG export test (titled `…PNG…`)
  // plus the field-stress tests (`PNG + SVG …`, also matched by /PNG/). That's
  // exactly where browsers differ: each engine has its own canvas/SVG
  // rasterizer (`svgToPng` in src/lib/download.ts). The SVG export is a
  // generated string — identical in every browser — and UI tests are
  // engine-agnostic React, so neither gains from a second/third engine.
  //
  // NOTE: WebKit here is Playwright's Linux WebKit, a good *engine* proxy for
  // Safari but NOT real CoreGraphics — imperfect for iOS canvas fidelity.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: /PNG/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /PNG/,
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
