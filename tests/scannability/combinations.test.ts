/**
 * @vitest-environment node
 *
 * Combinatorial scannability matrix.
 *
 * The finder-shapes guard varies one axis (finder shape) against default
 * modules. This file covers the *interactions* the product actually ships —
 * module shape × finder shape × center overlay — because that's where
 * readability quietly dies: a `dot` field under a `circle` finder with a
 * center icon eats margin from three directions at once.
 *
 * Two layers, mirroring the rest of the suite:
 *   1. Every shipping combination decodes CLEAN on a quorum (≥3 of 4) of the
 *      engines (jsQR, ZXing-JS, ZXing-wasm, ZBar), exhaustively over the
 *      cartesian product — including every center-overlay state (none / icon /
 *      text / both), since a center label draws on the error-correction budget
 *      just like an icon and stacking the two is the worst case. Quorum, not
 *      unanimity, because each engine has a documented blind spot on extreme
 *      shape stacks (see CLEAN_QUORUM).
 *   2. A curated set of high-risk combinations survives the full field
 *      battery (the four classic degradations PLUS rotate / jpeg / glare /
 *      noise / occlusion / perspective) within a margin of the plain-square
 *      baseline. This is the regression net: it fails if a future change
 *      craters a specific combination's field reliability.
 *
 * Runs in the `node` environment (sharp + decoders need it, not jsdom).
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { validatePayload } from '../../src/lib/payload';
import {
  generateQr,
  qrToSvgString,
  styleHasOverlay,
  MIN_OVERLAY_VERSION,
  type QrStyle,
} from '../../src/lib/qr';
import { DECODERS } from './decoders';
import {
  shrink,
  blur,
  lowContrast,
  shear,
  rotate,
  jpeg,
  glare,
  noise,
  occlusion,
  perspective,
} from './stress';
import type { Rgba } from './stress';
import { MODULE_SHAPES, FINDER_SHAPES, OVERLAYS, styleFor } from './matrix';
import { GUARDS } from './guards';

const BG = { r: 240, g: 237, b: 226, alpha: 1 };

// Short (no alignment patterns) + long (alignment patterns) so the matrix
// exercises both locator regimes.
const CLEAN_PAYLOAD = 'https://example.com/path?q=value';
const STRESS_PAYLOAD =
  'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar';

function renderMaster(payload: string, style: QrStyle, px = 1024): Promise<Buffer> {
  const v = validatePayload(payload);
  if (!v.ok) throw new Error(`invalid test payload: ${payload}`);
  const qr = generateQr(
    v.value,
    styleHasOverlay(style) ? { minVersion: MIN_OVERLAY_VERSION } : undefined,
  );
  const svg = qrToSvgString(qr, style);
  return sharp(Buffer.from(svg), { density: 600 })
    .resize(px, px, { fit: 'contain', background: BG })
    .png()
    .toBuffer();
}

async function rgbaOf(master: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(master)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

// A field battery spanning every degradation family, at moderate-to-hard
// levels chosen to discriminate a healthy combo from a regressing one
// (extreme levels fail everything and carry no signal).
const BATTERY: ((m: Buffer) => Promise<Rgba>)[] = [
  (m) => shrink(m, 110),
  (m) => shrink(m, 72),
  (m) => blur(m, 2),
  (m) => blur(m, 3.5),
  (m) => lowContrast(m, 0.27),
  (m) => shear(m, 0.4),
  (m) => rotate(m, 20),
  (m) => jpeg(m, 25),
  (m) => glare(m, 0.85),
  (m) => noise(m, 30),
  (m) => occlusion(m, 0.18),
  (m) => perspective(m, 0.12),
];

/** Fraction of (battery level × decoder) trials that decoded `payload`. */
async function robustness(style: QrStyle, payload: string): Promise<number> {
  const master = await renderMaster(payload, style);
  let ok = 0;
  let total = 0;
  for (const apply of BATTERY) {
    const img = await apply(master);
    for (const decoder of DECODERS) {
      total++;
      const r = await decoder.fn(img.rgba, img.width, img.height);
      if (r.ok && r.text === payload) ok++;
    }
  }
  return ok / total;
}

// Clean decode requires a quorum, not unanimity. Each engine has documented
// blind spots on extreme shape stacks even on a perfect render — jsQR mis-reads
// `dot` modules under `chamfer` finders; ZBar mis-reads `circle` finders behind
// a center icon — but never the same combo, so a 3-of-4 quorum proves every
// combination is broadly scannable while still failing any combo that breaks
// two or more engines.
const CLEAN_QUORUM = GUARDS.cleanQuorum;

describe('combinatorial scannability — clean decode', () => {
  for (const moduleShape of MODULE_SHAPES) {
    for (const finderShape of FINDER_SHAPES) {
      for (const overlay of OVERLAYS) {
        const label = `${moduleShape}/${finderShape}/${overlay}`;
        it(`${label} decodes clean on ≥${CLEAN_QUORUM}/${DECODERS.length} engines (both payloads)`, async () => {
          for (const payload of [CLEAN_PAYLOAD, STRESS_PAYLOAD]) {
            const master = await renderMaster(payload, styleFor(moduleShape, finderShape, overlay));
            const img = await rgbaOf(master);
            const failed: string[] = [];
            for (const decoder of DECODERS) {
              const r = await decoder.fn(img.rgba, img.width, img.height);
              if (!(r.ok && r.text === payload)) failed.push(decoder.name);
            }
            const passed = DECODERS.length - failed.length;
            expect(
              passed,
              `${label} / ${payload}: only ${passed}/${DECODERS.length} engines decoded (failed: ${failed.join(', ') || 'none'})`,
            ).toBeGreaterThanOrEqual(CLEAN_QUORUM);
          }
        }, 30_000);
      }
    }
  }
});

describe('combinatorial scannability — field battery', () => {
  // High-risk combinations: each stacks shaped modules, shaped finders, and/or
  // a center overlay so the test exercises their interaction under stress.
  const RISKY: { name: string; style: QrStyle }[] = [
    { name: 'dot · circle · icon', style: styleFor('dot', 'circle', 'icon') },
    { name: 'dot · square · icon', style: styleFor('dot', 'square', 'icon') },
    { name: 'h-pill · rounded · plain', style: styleFor('horizontal-pill', 'rounded', 'none') },
    { name: 'v-pill · chamfer · plain', style: styleFor('vertical-pill', 'chamfer', 'none') },
    { name: 'rounded · circle · icon', style: styleFor('rounded', 'circle', 'icon') },
    { name: 'chamfer · chamfer · icon', style: styleFor('chamfer', 'chamfer', 'icon') },
    // Center text and the icon+text stack — the heaviest draw on the
    // error-correction budget — over the worst module/finder backdrops. This is
    // the field-battery coverage center text previously lacked (it was decoded
    // only clean, by jsQR, in E2E).
    { name: 'dot · square · text', style: styleFor('dot', 'square', 'text') },
    { name: 'rounded · circle · both', style: styleFor('rounded', 'circle', 'both') },
  ];

  // Margin below the plain-square baseline a shipping combination may sit, and
  // an absolute floor. Measured spread baseline→worst combo is ~15 points; the
  // 0.20 margin leaves headroom for engine/version drift while still failing a
  // genuine crater. The 0.40 floor catches a combo that collapses outright.
  const MARGIN = GUARDS.combosMargin;
  const FLOOR = GUARDS.robustnessFloor;

  it(`every high-risk combination scans within ${MARGIN * 100}% of the square baseline`, async () => {
    const baseline = await robustness(styleFor('square', 'square', false), STRESS_PAYLOAD);
    expect(baseline, 'square baseline sanity').toBeGreaterThan(FLOOR);
    for (const { name, style } of RISKY) {
      const score = await robustness(style, STRESS_PAYLOAD);
      const pct = (score * 100).toFixed(0);
      const basePct = (baseline * 100).toFixed(0);
      expect(
        score,
        `${name}: ${pct}% vs square ${basePct}% (margin ${MARGIN * 100}%)`,
      ).toBeGreaterThanOrEqual(baseline - MARGIN);
      expect(score, `${name}: ${pct}% below absolute floor ${FLOOR * 100}%`).toBeGreaterThanOrEqual(
        FLOOR,
      );
    }
  }, 180_000);
});
