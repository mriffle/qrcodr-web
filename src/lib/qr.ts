import QRCode from 'qrcode';
import type { ValidatedPayload } from './payload';

/**
 * Visual configuration for QR rendering. v1 only respects foreground and
 * background; the shape fields are declared so v2 can extend rendering
 * without API churn in the components that consume QrStyle.
 */
export type QrStyle = {
  foreground: string;
  background: string;
  moduleShape: 'square'; // v2: 'rounded' | 'dot'
  canvasShape: 'square'; // v2: 'circle' | 'hex'
  centerIcon?: { svg: string; sizeRatio: number };
};

export type QrResult = {
  /** Row-major `Uint8Array` of 0/1 bytes, length = size * size. */
  matrix: Uint8Array;
  /** Side length in modules, excluding the quiet zone. */
  size: number;
  /** QR version 1..40. */
  version: number;
  errorCorrection: 'H';
  payload: ValidatedPayload;
};

/** Quiet zone width in modules. The spec recommends 4. */
export const QUIET_ZONE = 4;

export const DEFAULT_STYLE: QrStyle = {
  foreground: '#0f1b3d',
  background: '#f0ede2',
  moduleShape: 'square',
  canvasShape: 'square',
};

/**
 * Generate a QR matrix from a validated payload. Uses error-correction
 * level H (~30% redundancy) to leave headroom for the v2 center-icon
 * overlay without breaking scannability.
 */
export function generateQr(payload: ValidatedPayload): QrResult {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'H' });
  return {
    matrix: qr.modules.data,
    size: qr.modules.size,
    version: qr.version,
    errorCorrection: 'H',
    payload,
  };
}

/**
 * Render a QR result as a standalone, scannable SVG string. Includes the
 * quiet zone. This is the canonical export artifact — the `.svg` download
 * and the source rasterized into PNG both go through this function. The
 * Apparatus chrome (dimension lines, registration marks) lives in the
 * React component and is intentionally NOT part of the exported SVG.
 */
export function qrToSvgString(qr: QrResult, style: QrStyle): string {
  const { matrix, size } = qr;
  const total = size + QUIET_ZONE * 2;
  const modules: string[] = [];
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x++) {
      if (matrix[rowOffset + x] === 1) {
        modules.push(`<rect x="${QUIET_ZONE + x}" y="${QUIET_ZONE + y}" width="1" height="1"/>`);
      }
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="${style.background}"/>`,
    `<g fill="${style.foreground}">${modules.join('')}</g>`,
    `</svg>`,
  ].join('');
}
