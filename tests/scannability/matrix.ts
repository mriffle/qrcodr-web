/**
 * Shared combinatorial matrix for the file-based "real platform" decoder layers
 * (OpenCV/WeChat via Python, Apple Vision via Swift). Each of those tests
 * renders the same module × finder × center-overlay × payload grid to PNG files
 * and hands a manifest to an external decoder, so the rendering lives here once.
 *
 * (The in-process `combinations.test.ts` keeps its own renderer — it decodes
 * buffers in-process and also stresses them, so it doesn't share this file path.)
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { validatePayload } from '../../src/lib/payload';
import { generateQr, qrToSvgString, DEFAULT_STYLE, type QrStyle } from '../../src/lib/qr';
import { findCenterIcon } from '../../src/lib/center-icons';

export const MODULE_SHAPES = [
  'square',
  'rounded',
  'chamfer',
  'dot',
  'horizontal-pill',
  'vertical-pill',
] as const satisfies readonly QrStyle['moduleShape'][];

export const FINDER_SHAPES = [
  'square',
  'rounded',
  'chamfer',
  'circle',
] as const satisfies readonly QrStyle['finderShape'][];

export const PAYLOADS = {
  short: 'https://example.com/path?q=value',
  long: 'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar',
} as const;
export type PayloadKind = keyof typeof PAYLOADS;

const HEART = findCenterIcon('heart');
const ICON = { id: 'heart', innerSvg: HEART.innerSvg } as const;
const BG = { r: 240, g: 237, b: 226, alpha: 1 };
const PX = 700;

export type Combo = {
  moduleShape: QrStyle['moduleShape'];
  finderShape: QrStyle['finderShape'];
  withIcon: boolean;
  payloadKind: PayloadKind;
  expect: string;
  path: string;
  label: string;
};

export function styleFor(
  moduleShape: QrStyle['moduleShape'],
  finderShape: QrStyle['finderShape'],
  withIcon: boolean,
): QrStyle {
  return {
    ...DEFAULT_STYLE,
    moduleShape,
    finderShape,
    ...(withIcon ? { centerIcon: ICON } : {}),
  };
}

/**
 * Render the full module × finder × icon × payload matrix into `dir` as PNGs
 * (one production `qrToSvgString` rasterized per cell) and return the combos
 * with their file paths — ready to hand to an external decoder via a manifest.
 */
export async function renderMatrixToDir(dir: string): Promise<Combo[]> {
  const combos: Combo[] = [];
  let i = 0;
  for (const moduleShape of MODULE_SHAPES) {
    for (const finderShape of FINDER_SHAPES) {
      for (const withIcon of [false, true] as const) {
        for (const payloadKind of ['short', 'long'] as const) {
          combos.push({
            moduleShape,
            finderShape,
            withIcon,
            payloadKind,
            expect: PAYLOADS[payloadKind],
            path: join(dir, `c${String(i++)}.png`),
            label: `${moduleShape}/${finderShape}/${withIcon ? 'icon' : 'plain'}/${payloadKind}`,
          });
        }
      }
    }
  }
  await Promise.all(
    combos.map(async (c) => {
      const v = validatePayload(c.expect);
      if (!v.ok) throw new Error(`invalid payload: ${c.expect}`);
      const svg = qrToSvgString(
        generateQr(v.value),
        styleFor(c.moduleShape, c.finderShape, c.withIcon),
      );
      await sharp(Buffer.from(svg), { density: 600 })
        .resize(PX, PX, { fit: 'contain', background: BG })
        .png()
        .toFile(c.path);
    }),
  );
  return combos;
}

/** Serialize combos to the `{path, expect}[]` manifest the decoder tools read. */
export function manifestOf(combos: Combo[]): string {
  return JSON.stringify(combos.map((c) => ({ path: c.path, expect: c.expect })));
}
