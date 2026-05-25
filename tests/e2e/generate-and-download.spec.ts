import { test, expect, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { DECODERS } from '../scannability/decoders';
import { shrink, blur, shear, jpeg, glare, occlusion, perspective } from '../scannability/stress';
import type { Rgba } from '../scannability/stress';
import { GUARDS } from '../scannability/guards';

/** Decode a QR code from a PNG buffer. Throws if no QR is found. */
async function decodePng(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(pixels, info.width, info.height);
  if (!result) throw new Error('jsQR could not decode the PNG');
  return result.data;
}

/** Rasterize an SVG buffer and decode the resulting QR. */
async function decodeSvg(buffer: Buffer, pxSize = 512): Promise<string> {
  // density: render the SVG at higher resolution for crisper modules before decoding.
  const png = await sharp(buffer, { density: 384 })
    .resize(pxSize, pxSize, { fit: 'contain' })
    .png()
    .toBuffer();
  return decodePng(png);
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

/** Open the module-shape dropdown and pick the option with the given test id. */
async function selectShape(page: Page, optionTestId: string): Promise<void> {
  await page.getByTestId('module-shape-trigger').click();
  await page.getByTestId(optionTestId).click();
}

/** Open the finder-shape dropdown and pick the option with the given test id. */
async function selectFinderShape(page: Page, optionTestId: string): Promise<void> {
  await page.getByTestId('finder-shape-trigger').click();
  await page.getByTestId(optionTestId).click();
}

const TEST_PAYLOADS = [
  { name: 'simple URL', value: 'https://example.com' },
  {
    name: 'URL with query params',
    value: 'https://example.com/path?query=value&other=test',
  },
  { name: 'plain text', value: 'Plain text — no URL here.' },
  {
    name: 'long URL',
    value: 'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar&baz=qux',
  },
] as const;

test.describe('qrcodr-web · UI behavior', () => {
  test('renders the masthead on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('QRCODR', { exact: false })).toBeVisible();
    await expect(page.getByTestId('title-date')).toBeVisible();
  });

  test('preview reflects payload changes', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('payload-input');
    await input.fill('https://anthropic.com');
    await expect(page.locator('.qr-frame[data-modules]')).toBeVisible();
  });

  test('empty payload disables export buttons and shows error', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('payload-input');
    await input.fill('');
    await expect(page.getByRole('status')).toHaveText(/required/i);
    await expect(page.getByTestId('export-png')).toBeDisabled();
    await expect(page.getByTestId('export-svg')).toBeDisabled();
  });

  test('typing restores the preview after an empty state', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('payload-input');
    await input.fill('');
    await expect(page.locator('[data-empty="true"]')).toBeVisible();
    await input.fill('hello');
    await expect(page.locator('.qr-frame[data-modules]')).toBeVisible();
  });

  test('telemetry panel shows live version/modules and collapses when emptied', async ({
    page,
  }) => {
    await page.goto('/');
    const version = page.locator('.telemetry__row[data-label="Version"] .telemetry__value');
    const modules = page.locator('.telemetry__row[data-label="Modules"] .telemetry__value');
    await expect(version).toHaveText(/^v\d+$/);
    await expect(modules).toHaveText(/^\d+ × \d+$/);
    await page.getByTestId('payload-input').fill('');
    await expect(version).toHaveText('—');
    await expect(modules).toHaveText('—');
  });
});

test.describe('qrcodr-web · PNG download decode', () => {
  for (const fixture of TEST_PAYLOADS) {
    test(`PNG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.png$/);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

test.describe('qrcodr-web · SVG download decode', () => {
  for (const fixture of TEST_PAYLOADS) {
    test(`SVG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-svg').click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.svg$/);
      const buffer = await readDownload(download);
      const decoded = await decodeSvg(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

test.describe('qrcodr-web · center icon decode', () => {
  test('selecting a center icon embeds it in the preview without breaking the layout', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('https://example.com');
    await page.getByTestId('center-icon-trigger').click();
    await page.getByTestId('center-icon-option-heart').click();
    // The preview SVG should now contain a transformed <g> for the icon.
    const overlay = page.locator('.qr-frame[data-modules] svg g[transform]');
    await expect(overlay).toBeVisible();
  });

  for (const fixture of TEST_PAYLOADS) {
    test(`PNG of "${fixture.name}" with heart center icon decodes back to its payload`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await page.getByTestId('center-icon-trigger').click();
      await page.getByTestId('center-icon-option-heart').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });

    test(`SVG of "${fixture.name}" with skull center icon decodes back to its payload`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await page.getByTestId('center-icon-trigger').click();
      await page.getByTestId('center-icon-option-skull').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-svg').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodeSvg(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

test.describe('qrcodr-web · center text decode', () => {
  test('typing center text embeds a <text> element in the preview', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('https://example.com');
    await page.getByTestId('center-text-input').fill('OPS');
    const overlayText = page.locator('.qr-frame[data-modules] svg text');
    await expect(overlayText).toHaveText('OPS');
  });

  test('respects the 10-character cap via maxLength', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('https://example.com');
    const input = page.getByTestId('center-text-input');
    await input.fill('abcdefghijklmn');
    await expect(input).toHaveValue('abcdefghij');
  });

  for (const fixture of TEST_PAYLOADS) {
    test(`PNG of "${fixture.name}" with center text "v2.0" decodes back to its payload`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await page.getByTestId('center-text-input').fill('v2.0');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });

    test(`SVG of "${fixture.name}" with center text "OPS" decodes back to its payload`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await page.getByTestId('center-text-input').fill('OPS');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-svg').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodeSvg(buffer);
      expect(decoded).toBe(fixture.value);
    });

    test(`PNG of "${fixture.name}" with heart icon + "v2" text decodes back to its payload`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await page.getByTestId('center-icon-trigger').click();
      await page.getByTestId('center-icon-option-heart').click();
      await page.getByTestId('center-text-input').fill('v2');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

test.describe('qrcodr-web · rounded modules decode', () => {
  test('toggling rounded mode flips the preview path to use arc commands', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('hello');
    const previewPath = page.locator('.qr-frame[data-modules] svg path');
    const squareD = await previewPath.getAttribute('d');
    expect(squareD).not.toMatch(/a0\.5,0\.5/);
    await selectShape(page, 'module-shape-rounded');
    const roundedD = await previewPath.getAttribute('d');
    expect(roundedD).toMatch(/a0\.5,0\.5/);
  });

  for (const fixture of TEST_PAYLOADS) {
    test(`rounded PNG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectShape(page, 'module-shape-rounded');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });

    test(`rounded SVG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectShape(page, 'module-shape-rounded');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-svg').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodeSvg(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

test.describe('qrcodr-web · dot modules decode', () => {
  test('toggling dot mode flips the preview path to use arc commands', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('hello');
    const previewPath = page.locator('.qr-frame[data-modules] svg path');
    const squareD = await previewPath.getAttribute('d');
    expect(squareD).not.toMatch(/a0\.5,0\.5/);
    await selectShape(page, 'module-shape-dot');
    const dotD = await previewPath.getAttribute('d');
    expect(dotD).toMatch(/a0\.5,0\.5/);
  });

  for (const fixture of TEST_PAYLOADS) {
    test(`dot PNG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectShape(page, 'module-shape-dot');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });

    test(`dot SVG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectShape(page, 'module-shape-dot');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-svg').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodeSvg(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

test.describe('qrcodr-web · chamfer modules decode', () => {
  test('toggling chamfer mode flips the preview path to 45° cut commands', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('hello');
    const previewPath = page.locator('.qr-frame[data-modules] svg path');
    const squareD = await previewPath.getAttribute('d');
    expect(squareD).not.toMatch(/l0\.5,0\.5/);
    await selectShape(page, 'module-shape-chamfer');
    const chamferD = await previewPath.getAttribute('d');
    expect(chamferD).toMatch(/l0\.5,0\.5/);
  });

  for (const fixture of TEST_PAYLOADS) {
    test(`chamfer PNG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectShape(page, 'module-shape-chamfer');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodePng(buffer);
      expect(decoded).toBe(fixture.value);
    });

    test(`chamfer SVG of "${fixture.name}" decodes back to its payload`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectShape(page, 'module-shape-chamfer');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-svg').click(),
      ]);
      const buffer = await readDownload(download);
      const decoded = await decodeSvg(buffer);
      expect(decoded).toBe(fixture.value);
    });
  }
});

// Every non-square module shape; each must round-trip back to the exact
// square path string (CLAUDE.md: square output is byte-for-byte identical
// regardless of prior selection).
const NON_SQUARE_MODULE_SHAPES = [
  'rounded',
  'chamfer',
  'dot',
  'horizontal-pill',
  'vertical-pill',
] as const;

test.describe('qrcodr-web · shape round-trip', () => {
  for (const shape of NON_SQUARE_MODULE_SHAPES) {
    test(`module shape ${shape} → square restores the byte-identical path`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill('hello');
      const previewPath = page.locator('.qr-frame[data-modules] svg path');
      const squareD = await previewPath.getAttribute('d');
      expect(squareD).toBeTruthy();
      await selectShape(page, `module-shape-${shape}`);
      // The shaped path must actually differ — otherwise the round-trip proves nothing.
      expect(await previewPath.getAttribute('d')).not.toBe(squareD);
      await selectShape(page, 'module-shape-square');
      expect(await previewPath.getAttribute('d')).toBe(squareD);
    });
  }

  test('finder shape bullseye → square restores the byte-identical path', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('hello');
    const previewPath = page.locator('.qr-frame[data-modules] svg path');
    const squareD = await previewPath.getAttribute('d');
    expect(squareD).toBeTruthy();
    await selectFinderShape(page, 'finder-shape-circle');
    expect(await previewPath.getAttribute('d')).not.toBe(squareD);
    await selectFinderShape(page, 'finder-shape-square');
    // Shaped finders emit fill-rule="evenodd"; returning to square must collapse
    // the path back to the plain (non-evenodd) string, byte-for-byte.
    expect(await previewPath.getAttribute('d')).toBe(squareD);
  });
});

const PILL_MODES = [
  { name: 'horizontal pill', testId: 'module-shape-horizontal-pill' },
  { name: 'vertical pill', testId: 'module-shape-vertical-pill' },
] as const;

for (const mode of PILL_MODES) {
  test.describe(`qrcodr-web · ${mode.name} modules decode`, () => {
    test(`toggling ${mode.name} mode flips the preview path to capsule arcs`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill('hello');
      const previewPath = page.locator('.qr-frame[data-modules] svg path');
      const squareD = await previewPath.getAttribute('d');
      expect(squareD).not.toMatch(/a0\.42,0\.42/);
      await selectShape(page, mode.testId);
      const pillD = await previewPath.getAttribute('d');
      expect(pillD).toMatch(/a0\.42,0\.42/);
    });

    for (const fixture of TEST_PAYLOADS) {
      test(`${mode.name} PNG of "${fixture.name}" decodes back to its payload`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.getByTestId('payload-input').fill(fixture.value);
        await selectShape(page, mode.testId);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('export-png').click(),
        ]);
        const buffer = await readDownload(download);
        const decoded = await decodePng(buffer);
        expect(decoded).toBe(fixture.value);
      });

      test(`${mode.name} SVG of "${fixture.name}" decodes back to its payload`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.getByTestId('payload-input').fill(fixture.value);
        await selectShape(page, mode.testId);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('export-svg').click(),
        ]);
        const buffer = await readDownload(download);
        const decoded = await decodeSvg(buffer);
        expect(decoded).toBe(fixture.value);
      });
    }
  });
}

const FINDER_SHAPES = [
  { name: 'rounded', testId: 'finder-shape-rounded' },
  { name: 'octagon', testId: 'finder-shape-chamfer' },
  { name: 'bullseye', testId: 'finder-shape-circle' },
] as const;

for (const fs of FINDER_SHAPES) {
  test.describe(`qrcodr-web · ${fs.name} finder decode`, () => {
    for (const fixture of TEST_PAYLOADS) {
      test(`${fs.name} finder PNG of "${fixture.name}" decodes back to its payload`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.getByTestId('payload-input').fill(fixture.value);
        await selectFinderShape(page, fs.testId);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('export-png').click(),
        ]);
        const decoded = await decodePng(await readDownload(download));
        expect(decoded).toBe(fixture.value);
      });

      test(`${fs.name} finder SVG of "${fixture.name}" decodes back to its payload`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.getByTestId('payload-input').fill(fixture.value);
        await selectFinderShape(page, fs.testId);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('export-svg').click(),
        ]);
        const decoded = await decodeSvg(await readDownload(download));
        expect(decoded).toBe(fixture.value);
      });
    }
  });
}

test.describe('qrcodr-web · finder shape preview + composition', () => {
  test('selecting bullseye flips the preview path to concentric finder arcs', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('payload-input').fill('https://example.com');
    const previewPath = page.locator('.qr-frame[data-modules] svg path');
    expect(await previewPath.getAttribute('d')).not.toMatch(/a3\.5,3\.5/);
    await selectFinderShape(page, 'finder-shape-circle');
    expect(await previewPath.getAttribute('d')).toMatch(/a3\.5,3\.5/);
  });

  // The hardest composition: shaped finders + a non-square module shape + a
  // center overlay, all at once.
  for (const fixture of TEST_PAYLOADS) {
    test(`bullseye finder + rounded modules + heart icon PNG of "${fixture.name}" decodes`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByTestId('payload-input').fill(fixture.value);
      await selectFinderShape(page, 'finder-shape-circle');
      await selectShape(page, 'module-shape-rounded');
      await page.getByTestId('center-icon-trigger').click();
      await page.getByTestId('center-icon-option-heart').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-png').click(),
      ]);
      const decoded = await decodePng(await readDownload(download));
      expect(decoded).toBe(fixture.value);
    });
  }
});

// Belt-and-suspenders: a non-square module shape combined with a center
// overlay. The overlay is carved independently of the module path, but
// these confirm the two features compose and still decode.
const SHAPE_OVERLAY_COMBOS: {
  name: string;
  shape: string;
  applyOverlay: (page: Page) => Promise<void>;
}[] = [
  {
    name: 'chamfer + heart icon',
    shape: 'module-shape-chamfer',
    applyOverlay: async (page) => {
      await page.getByTestId('center-icon-trigger').click();
      await page.getByTestId('center-icon-option-heart').click();
    },
  },
  {
    name: 'vertical pill + center text',
    shape: 'module-shape-vertical-pill',
    applyOverlay: async (page) => {
      await page.getByTestId('center-text-input').fill('v2');
    },
  },
];

test.describe('qrcodr-web · module shape + center overlay decode', () => {
  for (const combo of SHAPE_OVERLAY_COMBOS) {
    for (const fixture of TEST_PAYLOADS) {
      test(`${combo.name} PNG of "${fixture.name}" decodes back to its payload`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.getByTestId('payload-input').fill(fixture.value);
        await selectShape(page, combo.shape);
        await combo.applyOverlay(page);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('export-png').click(),
        ]);
        const decoded = await decodePng(await readDownload(download));
        expect(decoded).toBe(fixture.value);
      });

      test(`${combo.name} SVG of "${fixture.name}" decodes back to its payload`, async ({
        page,
      }) => {
        await page.goto('/');
        await page.getByTestId('payload-input').fill(fixture.value);
        await selectShape(page, combo.shape);
        await combo.applyOverlay(page);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByTestId('export-svg').click(),
        ]);
        const decoded = await decodeSvg(await readDownload(download));
        expect(decoded).toBe(fixture.value);
      });
    }
  }
});

// ── Real export artifacts under field stress (PNG + SVG) ────────────────────
// The decode tests above prove the downloaded artifacts read in PERFECT
// conditions. These take the SAME real artifacts and run them through the
// field-degradation battery, decoding with all four engines (jsQR, ZXing-JS,
// ZXing-wasm, ZBar). This is the only place the actual browser-canvas
// rasterization path (`svgToPng` in src/lib/download.ts) is stressed: the Node
// scannability suite can only rasterize the canonical SVG with sharp, so it
// would miss a canvas-specific antialiasing/scaling regression that leaves the
// PNG scannable when clean but fragile in the field. Both formats are covered:
// the PNG is the literal downloaded canvas output; the SVG is the downloaded
// canonical artifact, rasterized here exactly as the clean SVG tests do.
const STRESS_PAYLOAD =
  'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar';

const STRESS_BG = { r: 240, g: 237, b: 226, alpha: 1 };

// A lean cross-family battery (geometry + photometric + compression). Kept
// small so it doesn't dominate E2E wall time — the exhaustive battery and the
// relative-to-baseline comparison live in the Node scannability suite; here we
// only need to catch an export pipeline that emits field-fragile codes.
const E2E_BATTERY: { name: string; apply: (m: Buffer) => Promise<Rgba> }[] = [
  { name: 'shrink-96', apply: (m) => shrink(m, 96) },
  { name: 'blur-2.5', apply: (m) => blur(m, 2.5) },
  { name: 'shear-0.4', apply: (m) => shear(m, 0.4) },
  { name: 'jpeg-30', apply: (m) => jpeg(m, 30) },
  { name: 'glare-0.85', apply: (m) => glare(m, 0.85) },
  { name: 'occlusion-0.18', apply: (m) => occlusion(m, 0.18) },
  { name: 'perspective-0.12', apply: (m) => perspective(m, 0.12) },
];

// Absolute robustness floor over (battery × 4 engines): catches an export that
// collapses outright. Set below the hardest shipping composition (rounded +
// circle finder + icon measures ~50% on this battery — the Node suite owns the
// relative-to-baseline characterization; here we only guard against collapse).
const STRESS_FLOOR = GUARDS.robustnessFloor;

// The load-bearing assertion of this layer: the canvas-rasterized PNG must scan
// about as well as the canonical SVG under identical stress. A gap beyond this
// means the `<canvas>` path (antialiasing/scaling) introduced field fragility
// the SVG doesn't have — exactly the regression a Node-only test can't see.
const PNG_SVG_PARITY_MARGIN = GUARDS.pngSvgParityMargin;

/** Rasterize a downloaded SVG to a high-res master PNG for the battery. */
function svgToMasterPng(svg: Buffer): Promise<Buffer> {
  return sharp(svg, { density: 600 })
    .resize(1024, 1024, { fit: 'contain', background: STRESS_BG })
    .png()
    .toBuffer();
}

/** Run the battery over a master PNG and return the decode success rate. */
async function stressRobustness(master: Buffer, expected: string): Promise<number> {
  let ok = 0;
  let total = 0;
  for (const { apply } of E2E_BATTERY) {
    const img = await apply(master);
    for (const decoder of DECODERS) {
      total++;
      const r = await decoder.fn(img.rgba, img.width, img.height);
      if (r.ok && r.text === expected) ok++;
    }
  }
  return ok / total;
}

type StressStyle = { name: string; apply: (page: Page) => Promise<void> };
const STRESS_STYLES: StressStyle[] = [
  { name: 'default square', apply: () => Promise.resolve() },
  {
    name: 'rounded + circle finder + heart icon',
    apply: async (page) => {
      await selectShape(page, 'module-shape-rounded');
      await selectFinderShape(page, 'finder-shape-circle');
      await page.getByTestId('center-icon-trigger').click();
      await page.getByTestId('center-icon-option-heart').click();
    },
  },
];

/** Download one export format for the current page state and return its bytes. */
async function downloadExport(page: Page, format: 'png' | 'svg'): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(`export-${format}`).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  return readDownload(download);
}

test.describe('qrcodr-web · real export artifacts under field stress', () => {
  for (const style of STRESS_STYLES) {
    test(`PNG + SVG exports (${style.name}) survive the field battery`, async ({ page }) => {
      test.slow(); // two downloads + battery × 4 engines + wasm init exceed the default budget
      await page.goto('/');
      await page.getByTestId('payload-input').fill(STRESS_PAYLOAD);
      await style.apply(page);

      // The literal canvas-rasterized PNG the user downloads, and the canonical
      // SVG rasterized exactly as the clean SVG tests do.
      const pngMaster = await downloadExport(page, 'png');
      const svgMaster = await svgToMasterPng(await downloadExport(page, 'svg'));

      const pngScore = await stressRobustness(pngMaster, STRESS_PAYLOAD);
      const svgScore = await stressRobustness(svgMaster, STRESS_PAYLOAD);
      console.log(
        `[e2e-stress] ${style.name} — PNG ${(pngScore * 100).toFixed(0)}% · SVG ${(svgScore * 100).toFixed(0)}%`,
      );

      // Neither format may collapse in the field.
      expect(
        pngScore,
        `PNG ${style.name} robustness ${(pngScore * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(STRESS_FLOOR);
      expect(
        svgScore,
        `SVG ${style.name} robustness ${(svgScore * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(STRESS_FLOOR);

      // The canvas PNG must not scan materially worse than the SVG it's rendered
      // from — the regression guard the Node suite (sharp-only) can't provide.
      expect(
        pngScore,
        `PNG (${(pngScore * 100).toFixed(0)}%) lags SVG (${(svgScore * 100).toFixed(0)}%) by more than ${PNG_SVG_PARITY_MARGIN * 100}% — canvas rasterization regression?`,
      ).toBeGreaterThanOrEqual(svgScore - PNG_SVG_PARITY_MARGIN);
    });
  }
});
