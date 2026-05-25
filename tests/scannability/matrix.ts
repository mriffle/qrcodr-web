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
import {
  generateQr,
  qrToSvgString,
  styleHasOverlay,
  MIN_OVERLAY_VERSION,
  DEFAULT_STYLE,
  type QrStyle,
} from '../../src/lib/qr';
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

// `heart` is the single representative icon across the scannability/native
// layers, and that is sufficient by construction: `centerOverlayLayout` sizes
// the opaque backing plate from `hasIcon` + text length only — never the glyph
// — and the plate is what knocks out modules (the error-correction cost). The
// glyph is painted in the foreground *inside* that already-occluded plate, so a
// different icon can't occlude more or change scannability. Testing every glyph
// would re-measure identical plate geometry with different decorative fills, for
// no new signal — so we don't. (The plate-area cap is guarded directly in
// `overlay-budget`.)
const HEART = findCenterIcon('heart');
const ICON = { id: 'heart', innerSvg: HEART.innerSvg } as const;
/**
 * Representative center label. Short by design: the layout auto-fits the font
 * to the overlay box, so the text length changes the glyph size, not the
 * occluded (error-correction-consuming) area.
 */
const OVERLAY_TEXT = 'OPS';
const BG = { r: 240, g: 237, b: 226, alpha: 1 };
const PX = 700;

/**
 * The center-overlay states the product ships: nothing, an icon, a text label,
 * or both stacked (the heaviest draw on the error-correction budget). Varied
 * across the full module × finder grid because the overlay sits over the centre
 * data region and central alignment pattern, where shape stress compounds.
 */
export type Overlay = 'none' | 'icon' | 'text' | 'both';
export const OVERLAYS = ['none', 'icon', 'text', 'both'] as const satisfies readonly Overlay[];

export type Combo = {
  moduleShape: QrStyle['moduleShape'];
  finderShape: QrStyle['finderShape'];
  overlay: Overlay;
  payloadKind: PayloadKind;
  expect: string;
  path: string;
  label: string;
};

export function styleFor(
  moduleShape: QrStyle['moduleShape'],
  finderShape: QrStyle['finderShape'],
  overlay: Overlay,
): QrStyle {
  return {
    ...DEFAULT_STYLE,
    moduleShape,
    finderShape,
    centerIcon: overlay === 'icon' || overlay === 'both' ? ICON : null,
    centerText: overlay === 'text' || overlay === 'both' ? OVERLAY_TEXT : null,
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
      for (const overlay of OVERLAYS) {
        for (const payloadKind of ['short', 'long'] as const) {
          combos.push({
            moduleShape,
            finderShape,
            overlay,
            payloadKind,
            expect: PAYLOADS[payloadKind],
            path: join(dir, `c${String(i++)}.png`),
            label: `${moduleShape}/${finderShape}/${overlay}/${payloadKind}`,
          });
        }
      }
    }
  }
  await Promise.all(
    combos.map(async (c) => {
      const v = validatePayload(c.expect);
      if (!v.ok) throw new Error(`invalid payload: ${c.expect}`);
      const style = styleFor(c.moduleShape, c.finderShape, c.overlay);
      const qr = generateQr(
        v.value,
        styleHasOverlay(style) ? { minVersion: MIN_OVERLAY_VERSION } : undefined,
      );
      const svg = qrToSvgString(qr, style);
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
