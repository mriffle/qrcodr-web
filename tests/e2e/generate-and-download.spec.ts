import { test, expect, type Download } from '@playwright/test';
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
