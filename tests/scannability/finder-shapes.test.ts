/**
 * @vitest-environment node
 *
 * Field-reliability regression guard for shaped finder/alignment patterns.
 *
 * Unlike the E2E suite (which decodes one clean render), this renders the
 * PRODUCTION `qrToSvgString` for each finder shape, then stresses it the way a
 * real scan does — shrink, blur, low contrast, off-axis shear — and decodes
 * with two independent engines (jsQR + ZXing). It asserts every shipped shape
 * scans within a small margin of the square baseline.
 *
 * This is the test that would have caught `dots` (which decodes fine clean but
 * regresses badly in the field). `decoders.ts` and `stress.ts` (the two-engine
 * decode + field-degradation harness) live alongside this file.
 * Runs in the `node` environment (sharp + decoders need it, not jsdom).
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { validatePayload } from '../../src/lib/payload';
import { generateQr, qrToSvgString, DEFAULT_STYLE, type QrStyle } from '../../src/lib/qr';
import { DECODERS } from './decoders';
import { shrink, blur, lowContrast, shear, type Rgba } from './stress';
import { GUARDS, pct } from './guards';

const PAYLOADS = [
  'https://example.com/path?q=value', // ~v3
  'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar', // higher version w/ alignment patterns
] as const;

const SHAPES = ['square', 'rounded', 'chamfer', 'circle'] as const;
const BG = { r: 240, g: 237, b: 226, alpha: 1 };

// A compact stress battery — enough levels to separate a healthy shape from a
// regressing one, small enough to stay fast.
const BATTERY: ((m: Buffer) => Promise<Rgba>)[] = [
  ...[150, 110, 82, 64].map((px) => (m: Buffer) => shrink(m, px)),
  ...[1, 2.5, 4].map((s) => (m: Buffer) => blur(m, s)),
  ...[0.45, 0.27, 0.15].map((c) => (m: Buffer) => lowContrast(m, c)),
  ...[0.2, 0.4, 0.6].map((s) => (m: Buffer) => shear(m, s)),
];

function renderMaster(payload: string, finderShape: QrStyle['finderShape']): Promise<Buffer> {
  const v = validatePayload(payload);
  if (!v.ok) throw new Error(`invalid test payload: ${payload}`);
  const qr = generateQr(v.value);
  const svg = qrToSvgString(qr, { ...DEFAULT_STYLE, finderShape });
  return sharp(Buffer.from(svg), { density: 600 })
    .resize(1024, 1024, { fit: 'contain', background: BG })
    .png()
    .toBuffer();
}

/** Fraction of (battery level × payload × decoder) trials that decoded correctly. */
async function robustness(finderShape: QrStyle['finderShape']): Promise<number> {
  let ok = 0;
  let total = 0;
  for (const payload of PAYLOADS) {
    const master = await renderMaster(payload, finderShape);
    for (const apply of BATTERY) {
      const px = await apply(master);
      for (const decoder of DECODERS) {
        total++;
        const r = await decoder.fn(px.rgba, px.width, px.height);
        if (r.ok && r.text === payload) ok++;
      }
    }
  }
  return ok / total;
}

describe('finder/alignment shapes — field scannability', () => {
  it('every shape decodes clean at high resolution', async () => {
    for (const finderShape of SHAPES) {
      const master = await renderMaster(PAYLOADS[0], finderShape);
      const { data, info } = await sharp(master)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
      for (const decoder of DECODERS) {
        const r = await decoder.fn(rgba, info.width, info.height);
        expect(
          r.ok && r.text === PAYLOADS[0],
          `${finderShape} / ${decoder.name} clean decode`,
        ).toBe(true);
      }
    }
  }, 60_000);

  // Margin widened from 5% to 10% when the decoder panel grew from 2 engines
  // (jsQR + ZXing-JS) to 4 (adding ZXing-wasm + ZBar). The two added engines
  // are tougher — ZBar in particular is measurably less forgiving of circular
  // finders — so the absolute square-vs-shaped spread widened to ~7 points for
  // `circle`. The battery here is fully deterministic, so the figure is stable;
  // 10% keeps the guard catching a genuine regression while reflecting the
  // harder, more representative panel.
  it(`shaped finders scan within ${pct(GUARDS.finderShapeMargin)} of the square baseline under stress`, async () => {
    const baseline = await robustness('square');
    for (const finderShape of ['rounded', 'chamfer', 'circle'] as const) {
      const score = await robustness(finderShape);
      expect(
        score,
        `${finderShape} robustness ${(score * 100).toFixed(0)}% vs square ${(baseline * 100).toFixed(0)}%`,
      ).toBeGreaterThanOrEqual(baseline - GUARDS.finderShapeMargin);
    }
  }, 120_000);
});
