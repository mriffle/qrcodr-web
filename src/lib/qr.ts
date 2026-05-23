import QRCode from 'qrcode';
import { ORBITRON_BOLD_WOFF2_BASE64 } from '../assets/orbitron-bold-base64';
import type { ValidatedPayload } from './payload';

/**
 * Visual configuration for QR rendering. `moduleShape` selects whether
 * data modules render as crisp squares, smooth-blob rounded shapes that
 * merge into pills along runs, or fully separated circular dots that
 * never merge; `canvasShape` is a v2 hook not yet implemented.
 * `centerIcon` is an optional decorative overlay painted in the
 * foreground color, sized to stay safely under the H error-correction
 * budget. `centerText` is a short label (≤ CENTER_TEXT_MAX_LENGTH chars
 * after sanitization) rendered in the same carved-out region; when both
 * are present, text sits below the icon.
 */
export type QrStyle = {
  foreground: string;
  background: string;
  moduleShape: 'square' | 'rounded' | 'dot';
  canvasShape: 'square'; // v2: 'circle' | 'hex'
  centerIcon: { id: string; innerSvg: string } | null;
  centerText: string | null;
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

/**
 * Center-icon side length as a fraction of the QR matrix side. ~22% keeps
 * the icon plus its backing pad below ~7% of the QR area, comfortably under
 * the H error-correction practical ceiling (~25% area). Tuned to scan
 * reliably on every modern phone camera the E2E suite exercises.
 */
export const CENTER_ICON_SIZE_RATIO = 0.22;

/**
 * Padding (in module units) around the icon, filled with the background
 * color. Gives scanners a clean field so the icon isn't crashing into
 * adjacent dark modules — this is what makes the difference between
 * "usually scans" and "always scans".
 */
export const CENTER_ICON_PAD_MODULES = 0.8;

/** Hard cap on the user-supplied center-text label (after sanitization). */
export const CENTER_TEXT_MAX_LENGTH = 10;

/**
 * Approximate ratio of character advance width to font-size for the chosen
 * display font. Orbitron Bold is a wide geometric sans (uppercase glyphs sit
 * around 0.7–0.85em); 0.78 is a conservative average so 8-char labels still
 * fit inside the carved width without clipping.
 */
const CENTER_TEXT_CHAR_WIDTH_RATIO = 0.78;

/** Text-only mode: cap font size at this fraction of the carved area width. */
const CENTER_TEXT_MAX_FONT_TO_PAD_RATIO = 0.5;

/**
 * Icon + text mode: target font size (in module units) for the text row.
 * Sized to feel like a caption beneath the icon without dominating it.
 */
const CENTER_TEXT_COMPANION_FONT_MODULES = 1.4;

/** Gap (module units) between the icon and the text row when both are shown. */
const CENTER_TEXT_ROW_GAP_MODULES = 0.4;

/**
 * SVG `font-family` stack used for center text. Orbitron Bold matches the
 * masthead/display type in the HUD aesthetic. The web-loaded Orbitron face is
 * unreachable from sandboxed SVG-as-image (the PNG export path), so the stack
 * falls back to system sans-serif there. The exported SVG opened in a browser
 * with Orbitron available still renders in-brand.
 */
export const CENTER_TEXT_FONT_FAMILY = "'Orbitron', sans-serif";

export const DEFAULT_STYLE: QrStyle = {
  foreground: '#0f1b3d',
  background: '#f0ede2',
  moduleShape: 'square',
  canvasShape: 'square',
  centerIcon: null,
  centerText: null,
};

/**
 * Sanitize a raw user-entered center-text label: strip control characters,
 * trim whitespace, and cap to {@link CENTER_TEXT_MAX_LENGTH}. Returns the
 * cleaned string (possibly empty — callers map '' to null on QrStyle).
 */
export function sanitizeCenterText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  return stripped.trim().slice(0, CENTER_TEXT_MAX_LENGTH);
}

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
 * Emit a circle subpath inscribed in the (qx, qy) module cell. Two
 * 180° arcs traced clockwise from the left mid-point back to itself.
 * Unlike rounded mode, dots never merge with neighbors — every on-cell
 * is a discrete circle, which is what gives dot mode its distinctive
 * polka-dot look. Single leading `M` preserves the one-subpath-per-cell
 * invariant the count tests rely on.
 */
function emitDotSubpath(qx: number, qy: number): string {
  const r = MODULE_RADIUS;
  return `M${String(qx)},${String(qy + r)}a${String(r)},${String(r)} 0 0 1 1,0a${String(r)},${String(r)} 0 0 1 -1,0z`;
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
 * `style.moduleShape` is `'rounded'` or `'dot'` so the patterns scanners
 * rely on stay crisp.
 */
export function qrToSvgPath(
  matrix: Uint8Array,
  size: number,
  version: number,
  style: QrStyle,
): string {
  const subpaths: string[] = [];
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size;
    for (let x = 0; x < size; x++) {
      if (matrix[rowOffset + x] !== 1) continue;
      const qx = QUIET_ZONE + x;
      const qy = QUIET_ZONE + y;
      if (isReservedSquare(x, y, size, version)) {
        subpaths.push(emitSquareSubpath(qx, qy));
        continue;
      }
      switch (style.moduleShape) {
        case 'rounded':
          subpaths.push(emitRoundedSubpath(matrix, size, x, y, qx, qy));
          break;
        case 'dot':
          subpaths.push(emitDotSubpath(qx, qy));
          break;
        case 'square':
          subpaths.push(emitSquareSubpath(qx, qy));
          break;
      }
    }
  }
  return subpaths.join('');
}

/** Pick the right `shape-rendering` attribute for the chosen module shape. */
export function shapeRenderingFor(style: QrStyle): 'crispEdges' | 'geometricPrecision' {
  return style.moduleShape === 'square' ? 'crispEdges' : 'geometricPrecision';
}

/**
 * Geometry of the center-icon overlay in QR-SVG user units (one unit =
 * one module). Legacy shape kept for tests/callers that only deal with the
 * icon-only square layout. New code should prefer {@link centerOverlayLayout}.
 */
export type CenterIconLayout = {
  /** Top-left of the backing rect, in QR-SVG units (incl. quiet zone). */
  padX: number;
  padY: number;
  /** Side length of the backing rect (only valid when the layout is square). */
  padSize: number;
  /** Top-left of the icon's transformed bounding box. */
  iconX: number;
  iconY: number;
  /** Side length the 24-unit icon should scale to. */
  iconSize: number;
  /** Scale factor applied to the source 24-unit viewBox. */
  iconScale: number;
};

/**
 * Generalized placement for the center overlay (icon and/or text). The
 * carved-out backing rect can be non-square when both icon and text are
 * present — the box extends downward to fit a text row below the icon.
 * Coordinates are in QR-SVG user space (1 unit = 1 module, includes the
 * quiet zone).
 */
export type CenterOverlayLayout = {
  /** Backing rect geometry. Both width and height; not necessarily equal. */
  padX: number;
  padY: number;
  padWidth: number;
  padHeight: number;
  /** Icon placement when an icon is rendered; null otherwise. */
  icon: { x: number; y: number; size: number; scale: number } | null;
  /**
   * Text placement when a label is rendered; null otherwise. `x`/`y` is the
   * center point (use with `text-anchor="middle"` + `dominant-baseline="central"`);
   * `fontSize` is in module units.
   */
  text: { x: number; y: number; fontSize: number } | null;
};

/**
 * Compute the icon overlay placement for a QR of the given `size` (in
 * modules, excluding quiet zone). Coordinates are in the QR-SVG's user
 * space, which includes the quiet zone — so the icon centers on the QR
 * including its border, matching what scanners see.
 */
export function centerIconLayout(size: number): CenterIconLayout {
  const layout = centerOverlayLayout(size, true, 0);
  if (!layout.icon) {
    throw new Error('unreachable: icon-only overlay layout must produce an icon');
  }
  return {
    padX: layout.padX,
    padY: layout.padY,
    padSize: layout.padWidth,
    iconX: layout.icon.x,
    iconY: layout.icon.y,
    iconSize: layout.icon.size,
    iconScale: layout.icon.scale,
  };
}

/**
 * Compute placement for the carved-out center overlay (icon and/or text).
 *
 * - `hasIcon=true, textLength=0` → square carved area, icon centered.
 * - `hasIcon=false, textLength>0` → square carved area, text centered both axes
 *   with a font size chosen to fit the available width (and capped relative to
 *   the carved-area width so a single character doesn't render absurdly large).
 * - `hasIcon=true, textLength>0` → carved area extends downward to fit an
 *   icon row + small gap + text row. Icon stays at its current scannable size.
 * - Neither set → zero-sized layout (caller should skip emitting the overlay).
 */
export function centerOverlayLayout(
  size: number,
  hasIcon: boolean,
  textLength: number,
): CenterOverlayLayout {
  const total = size + QUIET_ZONE * 2;
  const cx = total / 2;
  const iconSize = size * CENTER_ICON_SIZE_RATIO;
  const padX0 = CENTER_ICON_PAD_MODULES;
  const padWidth = iconSize + padX0 * 2;
  const hasText = textLength > 0;

  if (!hasIcon && !hasText) {
    return { padX: 0, padY: 0, padWidth: 0, padHeight: 0, icon: null, text: null };
  }

  const availableTextWidth = padWidth - padX0 * 2;

  if (hasIcon && !hasText) {
    const padHeight = padWidth;
    return {
      padX: cx - padWidth / 2,
      padY: cx - padHeight / 2,
      padWidth,
      padHeight,
      icon: {
        x: cx - iconSize / 2,
        y: cx - iconSize / 2,
        size: iconSize,
        scale: iconSize / 24,
      },
      text: null,
    };
  }

  if (!hasIcon && hasText) {
    const padHeight = padWidth;
    const widthFit = availableTextWidth / (textLength * CENTER_TEXT_CHAR_WIDTH_RATIO);
    const fontSize = Math.min(widthFit, padWidth * CENTER_TEXT_MAX_FONT_TO_PAD_RATIO);
    return {
      padX: cx - padWidth / 2,
      padY: cx - padHeight / 2,
      padWidth,
      padHeight,
      icon: null,
      text: { x: cx, y: cx, fontSize },
    };
  }

  // Both icon and text.
  const widthFit = availableTextWidth / (textLength * CENTER_TEXT_CHAR_WIDTH_RATIO);
  const fontSize = Math.min(widthFit, CENTER_TEXT_COMPANION_FONT_MODULES);
  const gap = CENTER_TEXT_ROW_GAP_MODULES;
  const padHeight = padX0 + iconSize + gap + fontSize + padX0;
  const padX = cx - padWidth / 2;
  const padY = cx - padHeight / 2;
  return {
    padX,
    padY,
    padWidth,
    padHeight,
    icon: {
      x: cx - iconSize / 2,
      y: padY + padX0,
      size: iconSize,
      scale: iconSize / 24,
    },
    text: {
      x: cx,
      y: padY + padX0 + iconSize + gap + fontSize / 2,
      fontSize,
    },
  };
}

/**
 * Escape user-supplied text for safe inclusion as the body of an SVG `<text>`
 * element. Covers the five XML predefined entities so payloads like `<3` or
 * `&hack` cannot break SVG structure or sneak in markup.
 */
export function escapeXmlText(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return c;
    }
  });
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
  const overlay = renderCenterOverlay(style, size);
  const fontDefs = style.centerText && style.centerText.length > 0 ? renderFontDefs() : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(total)} ${String(total)}" shape-rendering="${shapeRendering}">`,
    fontDefs,
    `<rect width="${String(total)}" height="${String(total)}" fill="${style.background}"/>`,
    `<path fill="${style.foreground}" d="${d}"/>`,
    overlay,
    `</svg>`,
  ].join('');
}

/**
 * Emit a `<defs><style>` block embedding Orbitron Bold as an inline base64
 * WOFF2 data URL. Gated on `centerText` being present so icon-only exports
 * don't pay the ~9 KB cost. The inline data URL is the key: SVG-as-image
 * rendering (used by the PNG canvas path) is sandboxed from page-loaded
 * `@font-face` rules, but it does honor `@font-face` declarations defined
 * inside the SVG itself when the `src` is an inline data URL (no network).
 */
function renderFontDefs(): string {
  return [
    `<defs><style>`,
    `@font-face{`,
    `font-family:'Orbitron';`,
    `font-style:normal;`,
    `font-weight:700;`,
    `src:url(data:font/woff2;base64,${ORBITRON_BOLD_WOFF2_BASE64}) format('woff2');`,
    `}`,
    `</style></defs>`,
  ].join('');
}

/**
 * Render the carved-out center overlay: backing rect + optional icon group +
 * optional bold text. Returns an empty string when neither icon nor text is
 * configured (so callers don't have to branch). Icon SVGs use
 * `fill="currentColor"` so a single source paints in any foreground.
 */
function renderCenterOverlay(style: QrStyle, size: number): string {
  const icon = style.centerIcon && style.centerIcon.innerSvg.length > 0 ? style.centerIcon : null;
  const text = style.centerText && style.centerText.length > 0 ? style.centerText : null;
  if (!icon && !text) return '';

  const layout = centerOverlayLayout(size, icon !== null, text ? text.length : 0);
  const parts: string[] = [];
  parts.push(
    `<rect x="${String(layout.padX)}" y="${String(layout.padY)}" width="${String(layout.padWidth)}" height="${String(layout.padHeight)}" fill="${style.background}"/>`,
  );
  if (icon && layout.icon) {
    parts.push(
      `<g transform="translate(${String(layout.icon.x)} ${String(layout.icon.y)}) scale(${String(layout.icon.scale)})" color="${style.foreground}">`,
      icon.innerSvg,
      `</g>`,
    );
  }
  if (text && layout.text) {
    parts.push(
      `<text x="${String(layout.text.x)}" y="${String(layout.text.y)}" text-anchor="middle" dominant-baseline="central" font-family="${CENTER_TEXT_FONT_FAMILY}" font-weight="700" font-size="${String(layout.text.fontSize)}" fill="${style.foreground}">${escapeXmlText(text)}</text>`,
    );
  }
  return parts.join('');
}
