/**
 * Independent QR decoders, run over the same rasterized image so a shape's
 * scannability is judged against more than one detector. Each engine uses
 * different finder/alignment-pattern heuristics, which is exactly the axis
 * we stress here:
 *
 *  - jsQR            — pure-JS, the reference web scanner.
 *  - ZXing (JS)      — the JS port of ZXing, TRY_HARDER on.
 *  - ZXing (wasm)    — zxing-cpp compiled to wasm; this is the C++ engine that
 *                      a large share of native/mobile apps actually embed
 *                      (not the JS port), so it's a closer proxy for real
 *                      scanners than ZXing-JS.
 *  - ZBar (wasm)     — the ubiquitous embedded/Linux scanner, a genuinely
 *                      different detector lineage from the ZXing family.
 *
 * All decoders share one async signature so the harness can `await` them
 * uniformly; the two wasm engines lazy-load their module on first call.
 */
import { createRequire } from 'node:module';
import jsQR from 'jsqr';
import { readBarcodes } from 'zxing-wasm/reader';
import { scanImageData } from '@undecaf/zbar-wasm';

// @zxing/library ships a CommonJS build with no `exports` map, so a native ESM
// loader (Playwright's, and CI's Node 20) resolves it to the CJS entry and its
// module lexer can't see the named exports — `import { BinaryBitmap } from
// '@zxing/library'` throws "does not provide an export named 'BinaryBitmap'".
// (It only worked locally because Vite/vitest use the package's `module`/ESM
// build.) Loading it via `createRequire` sidesteps ESM named-export resolution
// entirely and works identically under Vite, Node, and Playwright.
const { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } =
  createRequire(import.meta.url)('@zxing/library') as typeof import('@zxing/library');

export type DecodeOutcome = { ok: true; text: string } | { ok: false };

/** Decode RGBA pixel data with jsQR. */
export function decodeJsQr(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<DecodeOutcome> {
  const result = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  return Promise.resolve(result ? { ok: true, text: result.data } : { ok: false });
}

/** Decode RGBA pixel data with the ZXing JS port (TRY_HARDER on). */
export function decodeZxingJs(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<DecodeOutcome> {
  // RGBLuminanceSource only accepts packed-Int32 pixels or a ready grayscale
  // buffer (length === width*height) — NOT raw RGBA bytes. Convert ourselves
  // using the same green-favouring luminance ZXing uses internally.
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    gray[i] = (r + 2 * g + b) >> 2;
  }
  const source = new RGBLuminanceSource(gray, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new QRCodeReader();
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  try {
    const result = reader.decode(bitmap, hints);
    return Promise.resolve({ ok: true, text: result.getText() });
  } catch {
    return Promise.resolve({ ok: false });
  }
}

/** Decode RGBA pixel data with zxing-cpp (wasm). */
export async function decodeZxingWasm(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<DecodeOutcome> {
  try {
    const results = await readBarcodes(
      { data: rgba, width, height },
      { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: true },
    );
    const hit = results.find((r) => r.text.length > 0);
    return hit ? { ok: true, text: hit.text } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Decode RGBA pixel data with ZBar (wasm). */
export async function decodeZbar(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<DecodeOutcome> {
  try {
    const symbols = await scanImageData({ data: rgba, width, height });
    const hit = symbols.find((s) => s.decode().length > 0);
    return hit ? { ok: true, text: hit.decode() } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type Decoder = {
  name: string;
  fn: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<DecodeOutcome>;
};

export const DECODERS: readonly Decoder[] = [
  { name: 'jsQR', fn: decodeJsQr },
  { name: 'ZXing-JS', fn: decodeZxingJs },
  { name: 'ZXing-wasm', fn: decodeZxingWasm },
  { name: 'ZBar', fn: decodeZbar },
] as const;

export type DecoderName = (typeof DECODERS)[number]['name'];
