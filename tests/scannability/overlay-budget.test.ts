/**
 * @vitest-environment node
 *
 * Center-overlay decode-cliff guard — the empirical half of the overlay
 * boundary guard (the geometric half is `tests/unit/overlay-budget.test.ts`).
 *
 * It proves three things the geometry test can't:
 *   1. The cliff is REAL: `"hello"` (a natural v1 code) + an icon+text overlay
 *      is broadly unscannable when generated naively, and the min-version
 *      policy (`MIN_OVERLAY_VERSION`) fixes it. This is the bug that motivated
 *      the policy, pinned so it can't silently come back.
 *   2. The floor version is FIELD-safe: a tiny payload forced up to
 *      MIN_OVERLAY_VERSION with the heaviest overlay clears the robustness floor
 *      under the degradation battery.
 *   3. The area ceiling (`GUARDS.overlayAreaCeiling`, enforced geometrically in
 *      the unit test) sits BELOW the real decode cliff: a centered opaque plate
 *      at the ceiling area still scans, but a clearly-over-budget plate does not.
 *
 * Runs in the `node` environment (sharp + decoders need it, not jsdom).
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { validatePayload } from '../../src/lib/payload';
import {
  generateQr,
  qrToSvgString,
  DEFAULT_STYLE,
  MIN_OVERLAY_VERSION,
  QUIET_ZONE,
  type QrStyle,
  type QrResult,
} from '../../src/lib/qr';
import { findCenterIcon } from '../../src/lib/center-icons';
import { DECODERS } from './decoders';
import { shrink, blur, shear, jpeg, perspective, type Rgba } from './stress';
import { GUARDS } from './guards';

const BG = { r: 240, g: 237, b: 226, alpha: 1 };
const PX = 900;
const HEART = findCenterIcon('heart');
const BOTH: QrStyle = {
  ...DEFAULT_STYLE,
  centerIcon: { id: 'heart', innerSvg: HEART.innerSvg },
  centerText: 'OPS',
};

function renderPng(qr: QrResult, style: QrStyle): Promise<Buffer> {
  return sharp(Buffer.from(qrToSvgString(qr, style)), { density: 600 })
    .resize(PX, PX, { fit: 'contain', background: BG })
    .png()
    .toBuffer();
}

async function rgbaOf(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/** Engines (of 4) that decode `want` from this image. */
async function panel(img: Rgba, want: string): Promise<number> {
  let ok = 0;
  for (const d of DECODERS) {
    const r = await d.fn(img.rgba, img.width, img.height);
    if (r.ok && r.text === want) ok++;
  }
  return ok;
}

function mustValidate(p: string): import('../../src/lib/payload').ValidatedPayload {
  const v = validatePayload(p);
  if (!v.ok) throw new Error(`invalid test payload: ${p}`);
  return v.value;
}

describe('center-overlay decode budget', () => {
  it('the v1 overlay cliff is real, and the min-version policy fixes it', async () => {
    const payload = 'hello';
    const value = mustValidate(payload);

    const naive = generateQr(value);
    expect(naive.version, "'hello' should naturally land at v1").toBe(1);
    const naiveOk = await panel(await rgbaOf(await renderPng(naive, BOTH)), payload);
    expect(
      naiveOk,
      `documents the bug: naive v1 + overlay decodes on only ${String(naiveOk)}/${String(DECODERS.length)} engines`,
    ).toBeLessThan(GUARDS.cleanQuorum);

    const fixed = generateQr(value, { minVersion: MIN_OVERLAY_VERSION });
    expect(fixed.version).toBeGreaterThanOrEqual(MIN_OVERLAY_VERSION);
    const fixedOk = await panel(await rgbaOf(await renderPng(fixed, BOTH)), payload);
    expect(
      fixedOk,
      `the min-version policy restores scannability (${String(fixedOk)}/${String(DECODERS.length)})`,
    ).toBeGreaterThanOrEqual(GUARDS.cleanQuorum);
  }, 30_000);

  it('an overlay forced to the floor version survives the field battery', async () => {
    const payload = 'hello';
    const qr = generateQr(mustValidate(payload), { minVersion: MIN_OVERLAY_VERSION });
    expect(qr.version).toBe(MIN_OVERLAY_VERSION);
    const master = await renderPng(qr, BOTH);

    const battery: ((m: Buffer) => Promise<Rgba>)[] = [
      (m) => shrink(m, 96),
      (m) => blur(m, 2.5),
      (m) => shear(m, 0.4),
      (m) => jpeg(m, 30),
      (m) => perspective(m, 0.12),
    ];
    let ok = 0;
    let total = 0;
    for (const apply of battery) {
      const img = await apply(master);
      ok += await panel(img, payload);
      total += DECODERS.length;
    }
    const rate = ok / total;
    expect(
      rate,
      `floor-version overlay robustness ${(rate * 100).toFixed(0)}% below floor ${(GUARDS.robustnessFloor * 100).toFixed(0)}%`,
    ).toBeGreaterThanOrEqual(GUARDS.robustnessFloor);
  }, 60_000);

  it('the area ceiling sits below the real decode cliff', async () => {
    // A healthy code with comfortable headroom; we occlude its center with an
    // opaque background plate of a chosen AREA fraction (modeling the overlay
    // backing plate exactly) and watch where decoding collapses.
    const value = mustValidate('https://example.com/path?q=value');
    const qr = generateQr(value);
    const master = await renderPng(qr, DEFAULT_STYLE);
    // The symbol (excluding the quiet zone) occupies this many px of the image.
    const symbolPx = PX * (qr.size / (qr.size + QUIET_ZONE * 2));

    const occludeAndDecode = async (areaFrac: number): Promise<number> => {
      const side = Math.round(Math.sqrt(areaFrac) * symbolPx);
      const patch = await sharp({
        create: { width: side, height: side, channels: 4, background: { ...BG } },
      })
        .png()
        .toBuffer();
      const offset = Math.round((PX - side) / 2);
      const png = await sharp(master)
        .composite([{ input: patch, left: offset, top: offset }])
        .png()
        .toBuffer();
      return panel(await rgbaOf(png), value);
    };

    const atCeiling = await occludeAndDecode(GUARDS.overlayAreaCeiling);
    expect(
      atCeiling,
      `a plate at the ceiling area (${(GUARDS.overlayAreaCeiling * 100).toFixed(0)}%) must still scan (${String(atCeiling)}/${String(DECODERS.length)})`,
    ).toBeGreaterThanOrEqual(GUARDS.cleanQuorum);

    const OVER_BUDGET = 0.4; // far past level-H tolerance — must collapse
    const atOver = await occludeAndDecode(OVER_BUDGET);
    expect(
      atOver,
      `a ${OVER_BUDGET * 100}%-area occlusion must break the quorum (proves the ceiling constrains; got ${String(atOver)}/${String(DECODERS.length)})`,
    ).toBeLessThan(GUARDS.cleanQuorum);
  }, 30_000);
});
