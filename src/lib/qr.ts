import QRCode from 'qrcode';
import type { ValidatedPayload } from './payload';

/**
 * Visual configuration for QR rendering. `moduleShape` selects whether
 * data modules render as crisp squares or smooth-blob rounded shapes;
 * `canvasShape` and `centerIcon` are v2 hooks not yet implemented.
 */
export type QrStyle = {
  foreground: string;
  background: string;
  moduleShape: 'square' | 'rounded'; // v2: 'dot'
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

/** Fixed module-rounding radius in module units. 0.5 = full circle / pill. */
const MODULE_RADIUS = 0.5;

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
 * Bounds-safe matrix accessor — off-grid cells count as 0 (off). The
 * rounded-corner predicate relies on this so edge cells round naturally
 * (their out-of-grid "neighbors" are treated as off).
 */
function moduleAt(matrix: Uint8Array, size: number, x: number, y: number): 0 | 1 {
  if (x < 0 || y < 0 || x >= size || y >= size) return 0;
  return matrix[y * size + x] === 1 ? 1 : 0;
}

/**
 * True if module (x,y) is inside one of the three 7×7 finder patterns
 * (top-left, top-right, bottom-left). Finder patterns must stay square
 * for scanner reliability — their 1:1:3:1:1 dark/light/dark/light/dark
 * ratio is what decoders lock onto.
 */
export function isFinderModule(x: number, y: number, size: number): boolean {
  // Top-left
  if (x < 7 && y < 7) return true;
  // Top-right
  if (x >= size - 7 && y < 7) return true;
  // Bottom-left
  if (x < 7 && y >= size - 7) return true;
  return false;
}

/**
 * True if module (x,y) is part of the timing pattern — the alternating
 * dotted strip on row 6 and column 6 between the finder patterns. Kept
 * square so the strip reads as a crisp ruler, which is how decoders use
 * it to anchor the sampling grid.
 */
export function isTimingModule(x: number, y: number, size: number): boolean {
  if (y === 6 && x >= 8 && x <= size - 9) return true;
  if (x === 6 && y >= 8 && y <= size - 9) return true;
  return false;
}

/**
 * Compute the row/column anchor coordinates for alignment patterns at a
 * given QR version. Returns an empty array for version 1 (no alignment
 * patterns). Mirrors the algorithm in the `qrcode` package's
 * lib/core/alignment-pattern.js so we don't drift from the matrix the
 * generator actually emits.
 */
function getAlignmentRowColCoords(version: number): number[] {
  if (version === 1) return [];
  const posCount = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
  const positions: number[] = [size - 7];
  for (let i = 1; i < posCount - 1; i++) {
    const prev = positions[i - 1];
    if (prev === undefined) continue;
    positions[i] = prev - intervals;
  }
  positions.push(6);
  return positions.reverse();
}

/**
 * Centers (cx, cy) of every alignment pattern present in a code of the
 * given version. Each center defines a 5×5 block at (cx-2..cx+2, cy-2..cy+2).
 * Excludes centers that overlap finder patterns (those are not alignment
 * patterns, just finders).
 */
function getAlignmentCenters(version: number): readonly [number, number][] {
  const pos = getAlignmentRowColCoords(version);
  const n = pos.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Skip the three corner positions occupied by finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) {
        continue;
      }
      const ci = pos[i];
      const cj = pos[j];
      if (ci === undefined || cj === undefined) continue;
      out.push([ci, cj]);
    }
  }
  return out;
}

/**
 * True if module (x,y) is inside any alignment pattern's 5×5 block.
 * Versions ≥ 2 have at least one. Kept square for the same reason as
 * finders — decoders use these to re-synchronize the sampling grid
 * under distortion.
 */
export function isAlignmentModule(x: number, y: number, _size: number, version: number): boolean {
  const centers = getAlignmentCenters(version);
  for (const [cx, cy] of centers) {
    if (x >= cx - 2 && x <= cx + 2 && y >= cy - 2 && y <= cy + 2) return true;
  }
  return false;
}

/**
 * Composite predicate: is this module part of a structural pattern that
 * must render as a crisp square regardless of `moduleShape`? Finders,
 * timing, and alignment all qualify.
 */
export function isReservedSquare(x: number, y: number, size: number, version: number): boolean {
  return (
    isFinderModule(x, y, size) ||
    isTimingModule(x, y, size) ||
    isAlignmentModule(x, y, size, version)
  );
}

export type ModuleCorner = 'tl' | 'tr' | 'br' | 'bl';

/**
 * True if the given outer corner of module (x,y) should be rounded.
 * A corner rounds only when BOTH cardinal neighbors at that corner are
 * off — so runs of adjacent on-modules visually merge into pills (the
 * shared edge stays straight), and isolated modules become full circles.
 * Inner concave corners (where two arms of an L meet) are not rounded
 * in v1 — exterior rounding only.
 */
export function shouldRoundCorner(
  matrix: Uint8Array,
  size: number,
  x: number,
  y: number,
  corner: ModuleCorner,
): boolean {
  switch (corner) {
    case 'tl':
      return moduleAt(matrix, size, x - 1, y) === 0 && moduleAt(matrix, size, x, y - 1) === 0;
    case 'tr':
      return moduleAt(matrix, size, x + 1, y) === 0 && moduleAt(matrix, size, x, y - 1) === 0;
    case 'br':
      return moduleAt(matrix, size, x + 1, y) === 0 && moduleAt(matrix, size, x, y + 1) === 0;
    case 'bl':
      return moduleAt(matrix, size, x - 1, y) === 0 && moduleAt(matrix, size, x, y + 1) === 0;
  }
}

/** Emit a single closed-square subpath for one on-module at (qx, qy). */
function emitSquareSubpath(qx: number, qy: number): string {
  return `M${String(qx)},${String(qy)}h1v1h-1z`;
}

/**
 * Emit a per-corner rounded subpath for one on-module at (qx, qy). At
 * `MODULE_RADIUS = 0.5`, four rounded corners produce a true circle and
 * a horizontal run produces a true pill (the shared edges between
 * adjacent on-cells stay straight because those corners' neighbors are
 * on).
 */
function emitRoundedSubpath(
  matrix: Uint8Array,
  size: number,
  x: number,
  y: number,
  qx: number,
  qy: number,
): string {
  const r = MODULE_RADIUS;
  const tl = shouldRoundCorner(matrix, size, x, y, 'tl');
  const tr = shouldRoundCorner(matrix, size, x, y, 'tr');
  const br = shouldRoundCorner(matrix, size, x, y, 'br');
  const bl = shouldRoundCorner(matrix, size, x, y, 'bl');

  const parts: string[] = [];
  parts.push(`M${String(qx + (tl ? r : 0))},${String(qy)}`);
  parts.push(`H${String(qx + 1 - (tr ? r : 0))}`);
  if (tr) parts.push(`a${String(r)},${String(r)} 0 0 1 ${String(r)},${String(r)}`);
  parts.push(`V${String(qy + 1 - (br ? r : 0))}`);
  if (br) parts.push(`a${String(r)},${String(r)} 0 0 1 ${String(-r)},${String(r)}`);
  parts.push(`H${String(qx + (bl ? r : 0))}`);
  if (bl) parts.push(`a${String(r)},${String(r)} 0 0 1 ${String(-r)},${String(-r)}`);
  parts.push(`V${String(qy + (tl ? r : 0))}`);
  if (tl) parts.push(`a${String(r)},${String(r)} 0 0 1 ${String(r)},${String(-r)}`);
  parts.push('z');
  return parts.join('');
}

/**
 * Build the combined `d` attribute for every on-module in the matrix.
 * One subpath per on-cell, all concatenated into a single path string —
 * this is what avoids antialiasing seams when the SVG is rasterized to
 * PNG (separate `<rect>` elements get their edges antialiased
 * independently and leave faint sub-pixel gaps between modules).
 *
 * Reserved cells (finder, timing, alignment) render as squares even when
 * `style.moduleShape === 'rounded'` so the patterns scanners rely on
 * stay crisp.
 */
export function qrToSvgPath(
  matrix: Uint8Array,
  size: number,
  version: number,
  style: QrStyle,
): string {
  const subpaths: string[] = [];
  const rounded = style.moduleShape === 'rounded';
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x++) {
      if (matrix[rowOffset + x] !== 1) continue;
      const qx = QUIET_ZONE + x;
      const qy = QUIET_ZONE + y;
      if (rounded && !isReservedSquare(x, y, size, version)) {
        subpaths.push(emitRoundedSubpath(matrix, size, x, y, qx, qy));
      } else {
        subpaths.push(emitSquareSubpath(qx, qy));
      }
    }
  }
  return subpaths.join('');
}

/** Pick the right `shape-rendering` attribute for the chosen module shape. */
export function shapeRenderingFor(style: QrStyle): 'crispEdges' | 'geometricPrecision' {
  return style.moduleShape === 'rounded' ? 'geometricPrecision' : 'crispEdges';
}

/**
 * Render a QR result as a standalone, scannable SVG string. Includes the
 * quiet zone. This is the canonical export artifact — the `.svg` download
 * and the source rasterized into PNG both go through this function. The
 * HUD chrome (corner brackets, reticle, masthead) lives in the React
 * component and is intentionally NOT part of the exported SVG.
 */
export function qrToSvgString(qr: QrResult, style: QrStyle): string {
  const { matrix, size, version } = qr;
  const total = size + QUIET_ZONE * 2;
  const d = qrToSvgPath(matrix, size, version, style);
  const shapeRendering = shapeRenderingFor(style);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(total)} ${String(total)}" shape-rendering="${shapeRendering}">`,
    `<rect width="${String(total)}" height="${String(total)}" fill="${style.background}"/>`,
    `<path fill="${style.foreground}" d="${d}"/>`,
    `</svg>`,
  ].join('');
}
