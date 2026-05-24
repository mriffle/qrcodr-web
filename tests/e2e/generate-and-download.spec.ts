import { test, expect, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import sharp from 'sharp';

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
