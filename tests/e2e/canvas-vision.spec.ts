/**
 * Canvas-PNG × Apple Vision — the one place the REAL browser-canvas export meets
 * the REAL iOS detector.
 *
 * The gap this closes: everywhere else, Apple Vision (and OpenCV/WeChat) decode
 * PNGs that `sharp` rasterized from the canonical SVG (`tests/scannability/matrix.ts`),
 * while the actual `<canvas>`-rasterized download (`svgToPng` in
 * `src/lib/download.ts`) is only ever decoded by the four in-process JS engines
 * (the rest of the E2E suite). So "does an iPhone read the file the user actually
 * downloads?" was inferred, never measured. Here Playwright drives the real app,
 * downloads the genuine canvas PNG, and hands it straight to
 * `VNDetectBarcodesRequest` — the detector iOS Camera / macOS use.
 *
 * Browser fidelity: in the dedicated CI job this runs on macOS, where
 * Playwright's `webkit` project is Apple WebKit (CoreGraphics-backed) — the
 * closest proxy to real iOS Safari's canvas short of a device — alongside
 * `chromium` for the desktop-Chrome export path.
 *
 * GATED: Apple Vision needs macOS + a Swift toolchain, so this self-skips
 * everywhere else (including the Linux E2E matrix legs that pick it up via the
 * `webkit`/`firefox` `grep: /PNG/` filter). It reuses the Apple Vision tool and
 * its `{path, expect}` manifest format verbatim (`tools/apple-vision/decode_qr.swift`).
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'tools', 'apple-vision', 'decode_qr.swift');

/** Vision is only available on macOS with a usable Swift toolchain. */
function appleVisionAvailable(): boolean {
  if (process.platform !== 'darwin' || !existsSync(SCRIPT)) return false;
  return spawnSync('swift', ['--version'], { encoding: 'utf-8' }).status === 0;
}

const AVAILABLE = appleVisionAvailable();

const SHORT = 'https://example.com/path?q=value';
const LONG = 'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar';

async function selectShape(page: Page, optionTestId: string): Promise<void> {
  await page.getByTestId('module-shape-trigger').click();
  await page.getByTestId(optionTestId).click();
}

async function selectFinderShape(page: Page, optionTestId: string): Promise<void> {
  await page.getByTestId('finder-shape-trigger').click();
  await page.getByTestId(optionTestId).click();
}

async function pickHeartIcon(page: Page): Promise<void> {
  await page.getByTestId('center-icon-trigger').click();
  await page.getByTestId('center-icon-option-heart').click();
}

/**
 * A curated set spanning the export's canvas path: the square baseline, the
 * hardest shipping shape stack, and every center-overlay state (icon, text, and
 * both) — the same axes the sharp-rasterized matrix covers, now through the real
 * `<canvas>` rasterizer instead.
 */
type Config = { name: string; payload: string; build: (page: Page) => Promise<void> };
const CONFIGS: Config[] = [
  { name: 'square · plain · short', payload: SHORT, build: () => Promise.resolve() },
  { name: 'square · plain · long', payload: LONG, build: () => Promise.resolve() },
  {
    name: 'rounded · circle · icon · long',
    payload: LONG,
    build: async (page) => {
      await selectShape(page, 'module-shape-rounded');
      await selectFinderShape(page, 'finder-shape-circle');
      await pickHeartIcon(page);
    },
  },
  {
    name: 'chamfer · chamfer · text · long',
    payload: LONG,
    build: async (page) => {
      await selectShape(page, 'module-shape-chamfer');
      await selectFinderShape(page, 'finder-shape-chamfer');
      await page.getByTestId('center-text-input').fill('OPS');
    },
  },
  {
    name: 'dot · square · icon+text (both) · long',
    payload: LONG,
    build: async (page) => {
      await selectShape(page, 'module-shape-dot');
      await pickHeartIcon(page);
      await page.getByTestId('center-text-input').fill('OPS');
    },
  },
  {
    name: 'dot · circle · icon · short',
    payload: SHORT,
    build: async (page) => {
      await selectShape(page, 'module-shape-dot');
      await selectFinderShape(page, 'finder-shape-circle');
      await pickHeartIcon(page);
    },
  },
];

type VisionRow = { path: string; expect: string; vision: string | null };

test.describe('qrcodr-web · canvas PNG export × Apple Vision', () => {
  test.skip(!AVAILABLE, 'requires macOS with a `swift` toolchain (the Apple Vision detector)');

  test('real canvas-rasterized PNG exports decode on Apple Vision', async ({ page }, testInfo) => {
    // Several real downloads + a Swift compile/run exceed the default budget.
    test.slow();

    const dir = mkdtempSync(join(tmpdir(), 'qrcodr-canvas-vision-'));
    const manifest: { path: string; expect: string; label: string }[] = [];

    for (const [i, cfg] of CONFIGS.entries()) {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(cfg.payload);
      await cfg.build(page);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.png$/);
      // Persist the genuine downloaded bytes at a manifest path for the decoder.
      const path = join(dir, `c${String(i)}.png`);
      writeFileSync(path, await readDownload(download));
      manifest.push({ path, expect: cfg.payload, label: cfg.name });
    }

    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(manifest.map((m) => ({ path: m.path, expect: m.expect }))),
    );
    // `swift <file>` compiles then runs the batch decoder in one invocation.
    const stdout = execFileSync('swift', [SCRIPT, manifestPath], {
      encoding: 'utf-8',
      maxBuffer: 1e8,
    });
    const rows = JSON.parse(stdout) as VisionRow[];
    const byPath = new Map(rows.map((r) => [r.path, r]));

    // The canvas export is a clean, 1024px, smoothing-disabled render; Vision
    // reads 100% of the equivalent sharp-rasterized matrix, so anything it can't
    // read here is a genuine canvas-pipeline defect — fail on it.
    const failed = manifest
      .filter((m) => byPath.get(m.path)?.vision !== m.expect)
      .map((m) => m.label);
    expect(
      failed,
      `[${testInfo.project.name}] Vision failed canvas PNGs: ${failed.join(', ') || 'none'}`,
    ).toEqual([]);
  });
});

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}
