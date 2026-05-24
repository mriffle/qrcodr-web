/**
 * Two independent QR decoders, run over the same rasterized image so a
 * shape's scannability can be judged against more than one detector. jsQR
 * and ZXing use different finder-pattern detection heuristics, which is
 * exactly the axis we're stressing here.
 */
import jsQR from 'jsqr';
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';

export type DecodeOutcome = { ok: true; text: string } | { ok: false };

/** Decode RGBA pixel data with jsQR. */
export function decodeJsQr(rgba: Uint8ClampedArray, width: number, height: number): DecodeOutcome {
  const result = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  return result ? { ok: true, text: result.data } : { ok: false };
}

/** Decode RGBA pixel data with ZXing's QRCodeReader (TRY_HARDER on). */
export function decodeZxing(rgba: Uint8ClampedArray, width: number, height: number): DecodeOutcome {
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
    return { ok: true, text: result.getText() };
  } catch {
    return { ok: false };
  }
}

export const DECODERS = [
  { name: 'jsQR', fn: decodeJsQr },
  { name: 'ZXing', fn: decodeZxing },
] as const;

export type DecoderName = (typeof DECODERS)[number]['name'];
