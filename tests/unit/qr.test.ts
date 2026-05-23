import { describe, expect, test } from 'vitest';
import {
  CENTER_ICON_PAD_MODULES,
  CENTER_ICON_SIZE_RATIO,
  CENTER_TEXT_MAX_LENGTH,
  DEFAULT_STYLE,
  QUIET_ZONE,
  centerOverlayLayout,
  escapeXmlText,
  generateQr,
  isAlignmentModule,
  isFinderModule,
  isReservedSquare,
  isTimingModule,
  qrToSvgPath,
  qrToSvgString,
  sanitizeCenterText,
  shouldRoundCorner,
} from '../../src/lib/qr';
import { findCenterIcon } from '../../src/lib/center-icons';
import { validatePayload, type ValidatedPayload } from '../../src/lib/payload';

function valid(s: string): ValidatedPayload {
  const r = validatePayload(s);
  if (!r.ok) throw new Error(`validation should succeed for fixture: ${s}`);
  return r.value;
}

describe('generateQr', () => {
  test('returns a matrix whose length equals size squared', () => {
    const qr = generateQr(valid('https://example.com'));
    expect(qr.matrix.length).toBe(qr.size * qr.size);
  });

  test('always uses error correction level H', () => {
    const qr = generateQr(valid('https://example.com'));
    expect(qr.errorCorrection).toBe('H');
  });

  test('reports a version between 1 and 40', () => {
    const qr = generateQr(valid('hi'));
    expect(qr.version).toBeGreaterThanOrEqual(1);
    expect(qr.version).toBeLessThanOrEqual(40);
  });

  test('larger payloads require >= version of smaller payloads', () => {
    const small = generateQr(valid('hi'));
    const big = generateQr(valid('a'.repeat(200)));
    expect(big.version).toBeGreaterThanOrEqual(small.version);
  });

  test('matrix contains a mix of on and off modules', () => {
    const qr = generateQr(valid('https://example.com'));
    const arr = Array.from(qr.matrix);
    const onCount = arr.filter((v) => v === 1).length;
    const offCount = arr.filter((v) => v === 0).length;
    expect(onCount).toBeGreaterThan(0);
    expect(offCount).toBeGreaterThan(0);
  });

  test('attaches the original payload to the result', () => {
    const qr = generateQr(valid('hello world'));
    expect(qr.payload).toBe('hello world');
  });

  test('finder patterns: top-left 7x7 corner has the expected outer ring', () => {
    // Every QR's three 7×7 finder patterns have a solid outer ring.
    // Spot-check the top-left finder at corners (0,0), (6,0), (0,6), (6,6).
    const qr = generateQr(valid('https://example.com'));
    const at = (x: number, y: number) => qr.matrix[y * qr.size + x];
    expect(at(0, 0)).toBe(1);
    expect(at(6, 0)).toBe(1);
    expect(at(0, 6)).toBe(1);
    expect(at(6, 6)).toBe(1);
    // Inner white ring (row 1 between cols 1..5 should be 0 except corners)
    expect(at(1, 1)).toBe(0);
  });
});

describe('qrToSvgString', () => {
  test('returns a well-formed SVG document', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, DEFAULT_STYLE);
    expect(svg.startsWith('<svg xmlns')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  test('viewBox dimensions include the quiet zone on both sides', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, DEFAULT_STYLE);
    const expected = qr.size + QUIET_ZONE * 2;
    expect(svg).toContain(`viewBox="0 0 ${String(expected)} ${String(expected)}"`);
  });

  test('background rect uses the style.background color', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, { ...DEFAULT_STYLE, background: '#abcdef' });
    expect(svg).toContain('fill="#abcdef"');
  });

  test('module group uses the style.foreground color', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, { ...DEFAULT_STYLE, foreground: '#123456' });
    expect(svg).toContain('fill="#123456"');
  });

  test('modules are emitted as a single <path> with one subpath per on-cell', () => {
    // Adjacent <rect>s produce sub-pixel seams when rasterized to PNG;
    // a single path has no internal edges. Enforce the structural choice.
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, DEFAULT_STYLE);
    const onCells = Array.from(qr.matrix).filter((v) => v === 1).length;
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(rectCount).toBe(1); // background only
    expect(pathCount).toBe(1); // modules
    const moveCommands = (svg.match(/M\d/g) ?? []).length;
    expect(moveCommands).toBe(onCells);
  });

  test('output is deterministic for the same payload', () => {
    const a = qrToSvgString(generateQr(valid('repeat-me')), DEFAULT_STYLE);
    const b = qrToSvgString(generateQr(valid('repeat-me')), DEFAULT_STYLE);
    expect(a).toBe(b);
  });

  test('declares an xmlns so the SVG can be rasterized as a standalone image', () => {
    const qr = generateQr(valid('x'));
    const svg = qrToSvgString(qr, DEFAULT_STYLE);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test('square mode declares shape-rendering="crispEdges"', () => {
    const qr = generateQr(valid('x'));
    const svg = qrToSvgString(qr, DEFAULT_STYLE);
    expect(svg).toContain('shape-rendering="crispEdges"');
  });
});

describe('isFinderModule', () => {
  test('detects every cell in the top-left finder', () => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        expect(isFinderModule(x, y, 25)).toBe(true);
      }
    }
  });

  test('detects every cell in the top-right finder', () => {
    const size = 25;
    for (let y = 0; y < 7; y++) {
      for (let x = size - 7; x < size; x++) {
        expect(isFinderModule(x, y, size)).toBe(true);
      }
    }
  });

  test('detects every cell in the bottom-left finder', () => {
    const size = 25;
    for (let y = size - 7; y < size; y++) {
      for (let x = 0; x < 7; x++) {
        expect(isFinderModule(x, y, size)).toBe(true);
      }
    }
  });

  test('rejects cells one step outside each finder boundary', () => {
    const size = 25;
    expect(isFinderModule(7, 0, size)).toBe(false);
    expect(isFinderModule(0, 7, size)).toBe(false);
    expect(isFinderModule(size - 8, 0, size)).toBe(false);
    expect(isFinderModule(size - 1, 7, size)).toBe(false);
    expect(isFinderModule(7, size - 1, size)).toBe(false);
  });

  test('does NOT flag the bottom-right corner — no finder there', () => {
    expect(isFinderModule(24, 24, 25)).toBe(false);
    expect(isFinderModule(20, 20, 25)).toBe(false);
  });
});

describe('isTimingModule', () => {
  test('row 6 is timing between the finder gaps, exclusive', () => {
    const size = 25;
    expect(isTimingModule(7, 6, size)).toBe(false); // still inside finder neighborhood
    expect(isTimingModule(8, 6, size)).toBe(true);
    expect(isTimingModule(size - 9, 6, size)).toBe(true);
    expect(isTimingModule(size - 8, 6, size)).toBe(false);
  });

  test('column 6 is timing between the finder gaps, exclusive', () => {
    const size = 25;
    expect(isTimingModule(6, 7, size)).toBe(false);
    expect(isTimingModule(6, 8, size)).toBe(true);
    expect(isTimingModule(6, size - 9, size)).toBe(true);
    expect(isTimingModule(6, size - 8, size)).toBe(false);
  });

  test('non-timing rows/cols return false', () => {
    expect(isTimingModule(10, 10, 25)).toBe(false);
    expect(isTimingModule(5, 8, 25)).toBe(false);
  });
});

describe('isAlignmentModule', () => {
  test('version 1 has no alignment patterns', () => {
    // v1 size = 21. Walk the whole matrix; nothing should be alignment.
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 21; x++) {
        expect(isAlignmentModule(x, y, 21, 1)).toBe(false);
      }
    }
  });

  test('version 2 has a single alignment pattern centered at (18, 18)', () => {
    const size = 25;
    // 5×5 block centered at (18, 18) → x,y in 16..20
    expect(isAlignmentModule(18, 18, size, 2)).toBe(true);
    expect(isAlignmentModule(16, 16, size, 2)).toBe(true);
    expect(isAlignmentModule(20, 20, size, 2)).toBe(true);
    expect(isAlignmentModule(15, 18, size, 2)).toBe(false);
    expect(isAlignmentModule(18, 21, size, 2)).toBe(false);
  });
});

describe('isReservedSquare', () => {
  test('finder cells are reserved', () => {
    expect(isReservedSquare(0, 0, 25, 2)).toBe(true);
  });

  test('timing cells are reserved', () => {
    expect(isReservedSquare(8, 6, 25, 2)).toBe(true);
  });

  test('alignment cells are reserved (v2+)', () => {
    expect(isReservedSquare(18, 18, 25, 2)).toBe(true);
  });

  test('a generic data cell is NOT reserved', () => {
    // (10, 12) on a v2 code is clearly outside any reserved region.
    expect(isReservedSquare(10, 12, 25, 2)).toBe(false);
  });
});

describe('shouldRoundCorner', () => {
  // Helper to build a small synthetic matrix from a 2D pattern.
  const make = (
    rows: readonly (readonly number[])[],
  ): {
    matrix: Uint8Array;
    size: number;
  } => {
    const size = rows.length;
    const matrix = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      const row = rows[y];
      if (!row) continue;
      for (let x = 0; x < size; x++) {
        matrix[y * size + x] = row[x] === 1 ? 1 : 0;
      }
    }
    return { matrix, size };
  };

  test('an isolated on-module rounds all four corners', () => {
    const { matrix, size } = make([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'tl')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'tr')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'br')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'bl')).toBe(true);
  });

  test('a horizontal pair rounds only the outer corners (merges into a pill)', () => {
    const { matrix, size } = make([
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ]);
    // Left cell: tl/bl round (outer), tr/br don't (right neighbor is on).
    expect(shouldRoundCorner(matrix, size, 1, 1, 'tl')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'bl')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'tr')).toBe(false);
    expect(shouldRoundCorner(matrix, size, 1, 1, 'br')).toBe(false);
    // Right cell: mirror.
    expect(shouldRoundCorner(matrix, size, 2, 1, 'tr')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 2, 1, 'br')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 2, 1, 'tl')).toBe(false);
    expect(shouldRoundCorner(matrix, size, 2, 1, 'bl')).toBe(false);
  });

  test('the concave corner of an L-shape stays unrounded (exterior only)', () => {
    // L:  [1 0]
    //     [1 1]
    // The "corner" cell at (1,1) has the elbow's concave corner at TL —
    // its left neighbor (0,1) is on AND its top neighbor (1,0) is on, so
    // TL must NOT round (would carve out the concave angle, which v1 skips).
    const { matrix, size } = make([
      [0, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ]);
    expect(shouldRoundCorner(matrix, size, 1, 2, 'tl')).toBe(false);
    // The bottom-right cell of the L is isolated on its right and bottom,
    // so BR rounds; TR rounds too (above is off, right is off).
    expect(shouldRoundCorner(matrix, size, 2, 2, 'br')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 2, 2, 'tr')).toBe(true);
  });

  test('out-of-bounds neighbors count as off, so edge cells round their outside corners', () => {
    const { matrix, size } = make([
      [1, 0],
      [0, 0],
    ]);
    // (0,0): left and top neighbors are off-grid (treated as 0).
    expect(shouldRoundCorner(matrix, size, 0, 0, 'tl')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 0, 0, 'tr')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 0, 0, 'bl')).toBe(true);
    expect(shouldRoundCorner(matrix, size, 0, 0, 'br')).toBe(true);
  });
});

describe('qrToSvgString — rounded mode', () => {
  const rounded = (overrides: Partial<typeof DEFAULT_STYLE> = {}) => ({
    ...DEFAULT_STYLE,
    moduleShape: 'rounded' as const,
    ...overrides,
  });

  test('emits arc commands when moduleShape is rounded', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, rounded());
    // The rounded subpath uses lowercase `a` for relative arcs at r=0.5.
    expect(svg).toMatch(/a0\.5,0\.5/);
  });

  test('rounded mode switches shape-rendering to geometricPrecision', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, rounded());
    expect(svg).toContain('shape-rendering="geometricPrecision"');
    expect(svg).not.toContain('shape-rendering="crispEdges"');
  });

  test('square mode emits no arc commands', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, DEFAULT_STYLE);
    expect(svg).not.toMatch(/a0\.5,0\.5/);
  });

  test('still emits exactly one <path> in rounded mode (no antialiasing seams)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, rounded());
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(1);
  });

  test('preserves one M per on-cell (each module is still its own subpath)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, rounded());
    const onCells = Array.from(qr.matrix).filter((v) => v === 1).length;
    // Match M followed by a digit or sign, just like the square-mode test.
    const moveCommands = (svg.match(/M[\d-]/g) ?? []).length;
    expect(moveCommands).toBe(onCells);
  });

  test('finder pattern subpaths contain no arc commands', () => {
    // Extract every subpath that starts inside a finder region and assert
    // none of them are rounded. This is the load-bearing structural check
    // that scanners' lock-on patterns stay crisp.
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, rounded());
    // Pull the `d` attribute.
    const dMatch = /d="([^"]+)"/.exec(svg);
    expect(dMatch).not.toBeNull();
    const d = dMatch?.[1];
    expect(d).toBeDefined();
    if (!d) return;
    // Split on M (subpath starts). Each fragment after split corresponds
    // to one subpath; reattach the leading M when checking coords.
    const fragments = d.split('M').filter((s) => s.length > 0);
    let finderSubpaths = 0;
    for (const frag of fragments) {
      // Coords look like "<qx>,<qy>..."; parse the leading "x,y".
      const coordMatch = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(frag);
      if (!coordMatch) continue;
      const qx = Number(coordMatch[1]);
      const qy = Number(coordMatch[2]);
      // Reverse the QUIET_ZONE offset to find the matrix-space coords.
      // Note: rounded subpaths start at (qx + 0.5, qy) for a rounded TL,
      // so subtract a possible 0.5 to recover the integer module index.
      const mx = Math.floor(qx) - QUIET_ZONE;
      const my = Math.floor(qy) - QUIET_ZONE;
      if (isFinderModule(mx, my, qr.size)) {
        finderSubpaths++;
        // Reserved squares should never contain an arc command.
        expect(frag).not.toContain('a0.5');
      }
    }
    // Sanity: at least the four corners of each of three finders are on.
    expect(finderSubpaths).toBeGreaterThan(10);
  });

  test('output is deterministic for the same payload', () => {
    const a = qrToSvgString(generateQr(valid('repeat-me')), rounded());
    const b = qrToSvgString(generateQr(valid('repeat-me')), rounded());
    expect(a).toBe(b);
  });
});

describe('qrToSvgString — chamfer mode', () => {
  const chamfer = (overrides: Partial<typeof DEFAULT_STYLE> = {}) => ({
    ...DEFAULT_STYLE,
    moduleShape: 'chamfer' as const,
    ...overrides,
  });

  test('emits straight 45° cut commands (l), not arcs', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, chamfer());
    // CHAMFER_DEPTH = 0.5, cuts are relative diagonal lines like "l0.5,0.5".
    expect(svg).toMatch(/l0\.5,0\.5/);
    // No arcs anywhere — chamfer is all straight lines.
    expect(svg).not.toMatch(/a0\.\d/);
  });

  test('chamfer mode switches shape-rendering to geometricPrecision', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, chamfer());
    expect(svg).toContain('shape-rendering="geometricPrecision"');
    expect(svg).not.toContain('shape-rendering="crispEdges"');
  });

  test('still emits exactly one <path> (no antialiasing seams)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, chamfer());
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });

  test('preserves one M per on-cell (merging is per-corner, not per-run)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, chamfer());
    const onCells = Array.from(qr.matrix).filter((v) => v === 1).length;
    const moveCommands = (svg.match(/M[\d-]/g) ?? []).length;
    expect(moveCommands).toBe(onCells);
  });

  test('finder pattern subpaths render as squares (no cut commands)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, chamfer());
    const d = /d="([^"]+)"/.exec(svg)?.[1];
    expect(d).toBeDefined();
    if (!d) return;
    const fragments = d.split('M').filter((s) => s.length > 0);
    let finderSubpaths = 0;
    for (const frag of fragments) {
      const coordMatch = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(frag);
      if (!coordMatch) continue;
      const mx = Math.floor(Number(coordMatch[1])) - QUIET_ZONE;
      const my = Math.floor(Number(coordMatch[2])) - QUIET_ZONE;
      if (isFinderModule(mx, my, qr.size)) {
        finderSubpaths++;
        expect(frag).not.toContain('l0.5');
      }
    }
    expect(finderSubpaths).toBeGreaterThan(10);
  });

  test('shared edges within a run stay flush (interior corners are not cut)', () => {
    // A horizontal run of 3: only the outer corners of the end cells are
    // cut, so the whole run carries exactly 4 cut commands (2 per end).
    const m = new Uint8Array(21 * 21);
    m[10 * 21 + 10] = 1;
    m[10 * 21 + 11] = 1;
    m[10 * 21 + 12] = 1;
    const d = qrToSvgPath(m, 21, 1, { ...DEFAULT_STYLE, moduleShape: 'chamfer' });
    expect((d.match(/M[\d-]/g) ?? []).length).toBe(3); // still one subpath per cell
    expect((d.match(/l/g) ?? []).length).toBe(4); // only the 4 exposed run-end corners
  });

  test('output is deterministic for the same payload', () => {
    expect(qrToSvgString(generateQr(valid('repeat-me')), chamfer())).toBe(
      qrToSvgString(generateQr(valid('repeat-me')), chamfer()),
    );
  });
});

describe('qrToSvgString — dot mode', () => {
  const dot = (overrides: Partial<typeof DEFAULT_STYLE> = {}) => ({
    ...DEFAULT_STYLE,
    moduleShape: 'dot' as const,
    ...overrides,
  });

  test('emits arc commands when moduleShape is dot', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, dot());
    expect(svg).toMatch(/a0\.5,0\.5/);
  });

  test('dot mode switches shape-rendering to geometricPrecision', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, dot());
    expect(svg).toContain('shape-rendering="geometricPrecision"');
    expect(svg).not.toContain('shape-rendering="crispEdges"');
  });

  test('still emits exactly one <path> in dot mode (no antialiasing seams)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, dot());
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(1);
  });

  test('preserves one M per on-cell (each dot is still its own subpath)', () => {
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, dot());
    const onCells = Array.from(qr.matrix).filter((v) => v === 1).length;
    const moveCommands = (svg.match(/M[\d-]/g) ?? []).length;
    expect(moveCommands).toBe(onCells);
  });

  test('finder pattern subpaths render as squares (no arc commands)', () => {
    // Same load-bearing structural check as rounded mode — the lock-on
    // patterns must stay crisp regardless of the data-module shape.
    const qr = generateQr(valid('https://example.com'));
    const svg = qrToSvgString(qr, dot());
    const dMatch = /d="([^"]+)"/.exec(svg);
    expect(dMatch).not.toBeNull();
    const d = dMatch?.[1];
    expect(d).toBeDefined();
    if (!d) return;
    const fragments = d.split('M').filter((s) => s.length > 0);
    let finderSubpaths = 0;
    for (const frag of fragments) {
      const coordMatch = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(frag);
      if (!coordMatch) continue;
      const qx = Number(coordMatch[1]);
      const qy = Number(coordMatch[2]);
      // Dot subpaths start at (qx, qy+0.5); square subpaths start at integer
      // (qx, qy). Floor recovers the module column either way; row needs a
      // similar floor since 0.5 only appears in the y of dot starts.
      const mx = Math.floor(qx) - QUIET_ZONE;
      const my = Math.floor(qy) - QUIET_ZONE;
      if (isFinderModule(mx, my, qr.size)) {
        finderSubpaths++;
        expect(frag).not.toContain('a0.5');
      }
    }
    expect(finderSubpaths).toBeGreaterThan(10);
  });

  test('output is deterministic for the same payload', () => {
    const a = qrToSvgString(generateQr(valid('repeat-me')), dot());
    const b = qrToSvgString(generateQr(valid('repeat-me')), dot());
    expect(a).toBe(b);
  });
});

describe('qrToSvgString — pill modes', () => {
  const hPill = (overrides: Partial<typeof DEFAULT_STYLE> = {}) => ({
    ...DEFAULT_STYLE,
    moduleShape: 'horizontal-pill' as const,
    ...overrides,
  });
  const vPill = (overrides: Partial<typeof DEFAULT_STYLE> = {}) => ({
    ...DEFAULT_STYLE,
    moduleShape: 'vertical-pill' as const,
    ...overrides,
  });

  test('emit arc commands (capsule caps) at the pill radius', () => {
    const qr = generateQr(valid('https://example.com'));
    // PILL_RADIUS = (1 - 2*0.08)/2 = 0.42.
    expect(qrToSvgString(qr, hPill())).toMatch(/a0\.42,0\.42/);
    expect(qrToSvgString(qr, vPill())).toMatch(/a0\.42,0\.42/);
  });

  test('switch shape-rendering to geometricPrecision', () => {
    const qr = generateQr(valid('https://example.com'));
    for (const svg of [qrToSvgString(qr, hPill()), qrToSvgString(qr, vPill())]) {
      expect(svg).toContain('shape-rendering="geometricPrecision"');
      expect(svg).not.toContain('shape-rendering="crispEdges"');
    }
  });

  test('still emit exactly one <path> (no antialiasing seams)', () => {
    const qr = generateQr(valid('https://example.com'));
    for (const svg of [qrToSvgString(qr, hPill()), qrToSvgString(qr, vPill())]) {
      expect((svg.match(/<path/g) ?? []).length).toBe(1);
    }
  });

  test('merge adjacent on-cells into runs (fewer subpaths than on-cells)', () => {
    // The defining property of pill mode: at least one run of length >= 2
    // fuses, so the subpath (M) count must be strictly below the on-cell
    // count. A real QR always has horizontal and vertical runs.
    const qr = generateQr(valid('https://example.com'));
    const onCells = Array.from(qr.matrix).filter((v) => v === 1).length;
    for (const svg of [qrToSvgString(qr, hPill()), qrToSvgString(qr, vPill())]) {
      const moveCommands = (svg.match(/M[\d-]/g) ?? []).length;
      expect(moveCommands).toBeLessThan(onCells);
    }
  });

  test('finder pattern subpaths render as squares (no arc commands)', () => {
    // Same load-bearing structural check as the other shapes: reserved
    // cells must stay crisp squares and a pill must never bridge them.
    const qr = generateQr(valid('https://example.com'));
    for (const svg of [qrToSvgString(qr, hPill()), qrToSvgString(qr, vPill())]) {
      const d = /d="([^"]+)"/.exec(svg)?.[1];
      expect(d).toBeDefined();
      if (!d) continue;
      const fragments = d.split('M').filter((s) => s.length > 0);
      let finderSubpaths = 0;
      for (const frag of fragments) {
        const coordMatch = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(frag);
        if (!coordMatch) continue;
        const mx = Math.floor(Number(coordMatch[1])) - QUIET_ZONE;
        const my = Math.floor(Number(coordMatch[2])) - QUIET_ZONE;
        if (isFinderModule(mx, my, qr.size)) {
          finderSubpaths++;
          expect(frag).not.toContain('a0.42');
        }
      }
      expect(finderSubpaths).toBeGreaterThan(10);
    }
  });

  test('output is deterministic for the same payload', () => {
    expect(qrToSvgString(generateQr(valid('repeat-me')), hPill())).toBe(
      qrToSvgString(generateQr(valid('repeat-me')), hPill()),
    );
  });

  // Direct qrToSvgPath tests on synthetic matrices — full control over run
  // layout, with data cells chosen away from v1 reserved regions
  // (finders x/y<7 or >=14; timing row/col 6).
  describe('run geometry (synthetic matrices)', () => {
    const SIZE = 21;
    const VERSION = 1;
    const mk = () => new Uint8Array(SIZE * SIZE);
    const set = (m: Uint8Array, x: number, y: number) => {
      m[y * SIZE + x] = 1;
    };

    test('a horizontal run of 3 becomes one capsule subpath', () => {
      const m = mk();
      set(m, 10, 10);
      set(m, 11, 10);
      set(m, 12, 10);
      const d = qrToSvgPath(m, SIZE, VERSION, {
        ...DEFAULT_STYLE,
        moduleShape: 'horizontal-pill',
      });
      expect((d.match(/M[\d-]/g) ?? []).length).toBe(1); // one merged run
      expect(d).toContain('H'); // straight top/bottom edges
      expect(d).toMatch(/a0\.42,0\.42/); // semicircular caps
    });

    test('a vertical run of 3 becomes one capsule subpath', () => {
      const m = mk();
      set(m, 10, 10);
      set(m, 10, 11);
      set(m, 10, 12);
      const d = qrToSvgPath(m, SIZE, VERSION, {
        ...DEFAULT_STYLE,
        moduleShape: 'vertical-pill',
      });
      expect((d.match(/M[\d-]/g) ?? []).length).toBe(1);
      expect(d).toContain('V'); // straight left/right edges
      expect(d).toMatch(/a0\.42,0\.42/);
    });

    test('a length-1 run renders as a circle, not a stubby capsule', () => {
      const m = mk();
      set(m, 10, 10); // isolated module
      const d = qrToSvgPath(m, SIZE, VERSION, {
        ...DEFAULT_STYLE,
        moduleShape: 'horizontal-pill',
      });
      // A circle is two 180° arcs and no straight edge commands.
      expect((d.match(/a0\.42,0\.42/g) ?? []).length).toBe(2);
      expect(d).not.toContain('H');
      expect(d).not.toContain('V');
    });

    test('an off cell splits a row into two separate runs', () => {
      const m = mk();
      set(m, 10, 10);
      set(m, 11, 10);
      // gap at x=12
      set(m, 13, 10);
      set(m, 14, 10);
      const d = qrToSvgPath(m, SIZE, VERSION, {
        ...DEFAULT_STYLE,
        moduleShape: 'horizontal-pill',
      });
      expect((d.match(/M[\d-]/g) ?? []).length).toBe(2);
    });
  });
});

describe('sanitizeCenterText', () => {
  test('trims surrounding whitespace', () => {
    expect(sanitizeCenterText('  hi  ')).toBe('hi');
  });

  test('caps to CENTER_TEXT_MAX_LENGTH characters', () => {
    expect(sanitizeCenterText('abcdefghijkl')).toHaveLength(CENTER_TEXT_MAX_LENGTH);
  });

  test('strips C0 control characters and DEL', () => {
    expect(sanitizeCenterText('a\x00b\x1fc\x7fd')).toBe('abcd');
  });

  test('preserves Unicode glyphs', () => {
    // Up to the cap. Common diacritics survive.
    const fixture = 'Æthelflæden-Ælflæd';
    expect(sanitizeCenterText(fixture)).toBe(fixture.slice(0, CENTER_TEXT_MAX_LENGTH));
  });

  test('returns empty string for whitespace-only input', () => {
    expect(sanitizeCenterText('   ')).toBe('');
    expect(sanitizeCenterText('')).toBe('');
  });
});

describe('escapeXmlText', () => {
  test('escapes the five XML predefined entities', () => {
    expect(escapeXmlText('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
  });

  test('leaves ordinary text untouched', () => {
    expect(escapeXmlText('OPS-42')).toBe('OPS-42');
  });

  test('order of operations: ampersands are escaped before other entities', () => {
    // Common bug: if you escape `<` to `&lt;` first then escape `&`, you get
    // `&amp;lt;`. A single pass with a character class avoids that.
    expect(escapeXmlText('a&b')).toBe('a&amp;b');
    expect(escapeXmlText('&<')).toBe('&amp;&lt;');
  });
});

describe('centerOverlayLayout', () => {
  const SIZE = 25;
  const padX0 = CENTER_ICON_PAD_MODULES;
  const iconSize = SIZE * CENTER_ICON_SIZE_RATIO;
  const padWidth = iconSize + padX0 * 2;
  const total = SIZE + QUIET_ZONE * 2;
  const cx = total / 2;

  test('returns a zero-sized layout when neither icon nor text is set', () => {
    const layout = centerOverlayLayout(SIZE, false, 0);
    expect(layout.padWidth).toBe(0);
    expect(layout.padHeight).toBe(0);
    expect(layout.icon).toBeNull();
    expect(layout.text).toBeNull();
  });

  test('icon-only layout is square and matches legacy icon geometry', () => {
    const layout = centerOverlayLayout(SIZE, true, 0);
    expect(layout.padWidth).toBeCloseTo(padWidth);
    expect(layout.padHeight).toBeCloseTo(padWidth);
    expect(layout.icon).not.toBeNull();
    expect(layout.text).toBeNull();
    expect(layout.icon?.size).toBeCloseTo(iconSize);
    // Icon centered on the QR (including quiet zone).
    expect((layout.icon?.x ?? 0) + iconSize / 2).toBeCloseTo(cx);
    expect((layout.icon?.y ?? 0) + iconSize / 2).toBeCloseTo(cx);
  });

  test('text-only layout is square, with text centered on the QR center', () => {
    const layout = centerOverlayLayout(SIZE, false, 4);
    expect(layout.padWidth).toBeCloseTo(padWidth);
    expect(layout.padHeight).toBeCloseTo(padWidth);
    expect(layout.icon).toBeNull();
    expect(layout.text).not.toBeNull();
    expect(layout.text?.x).toBeCloseTo(cx);
    expect(layout.text?.y).toBeCloseTo(cx);
    expect(layout.text?.fontSize ?? 0).toBeGreaterThan(0);
  });

  test('text-only font size shrinks as the text gets longer', () => {
    const short = centerOverlayLayout(SIZE, false, 2);
    const long = centerOverlayLayout(SIZE, false, 8);
    expect(short.text?.fontSize).toBeGreaterThan(long.text?.fontSize ?? Infinity);
  });

  test('icon-plus-text layout extends padHeight downward to fit text below the icon', () => {
    const layout = centerOverlayLayout(SIZE, true, 4);
    expect(layout.padWidth).toBeCloseTo(padWidth);
    expect(layout.padHeight).toBeGreaterThan(padWidth);
    expect(layout.icon).not.toBeNull();
    expect(layout.text).not.toBeNull();
    // Icon sits above text.
    expect(layout.icon?.y ?? 0).toBeLessThan(layout.text?.y ?? 0);
    // Both still horizontally centered.
    expect(layout.text?.x).toBeCloseTo(cx);
    expect((layout.icon?.x ?? 0) + (layout.icon?.size ?? 0) / 2).toBeCloseTo(cx);
  });

  test('icon size does not shrink when text is added next to it', () => {
    const iconOnly = centerOverlayLayout(SIZE, true, 0);
    const both = centerOverlayLayout(SIZE, true, 6);
    expect(both.icon?.size).toBeCloseTo(iconOnly.icon?.size ?? -1);
  });
});

describe('qrToSvgString — with center text', () => {
  const textStyle = (text: string) => ({ ...DEFAULT_STYLE, centerText: text });

  test('omits text overlay entirely when centerText is null or empty', () => {
    const qr = generateQr(valid('hello'));
    expect(qrToSvgString(qr, DEFAULT_STYLE)).not.toContain('<text');
    expect(qrToSvgString(qr, textStyle(''))).not.toContain('<text');
  });

  test('emits a centered bold <text> in the foreground color', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, { ...textStyle('OPS'), foreground: '#aa00bb' });
    expect(svg).toMatch(/<text [^>]*text-anchor="middle"[^>]*>OPS<\/text>/);
    expect(svg).toMatch(/<text [^>]*font-weight="700"[^>]*>OPS<\/text>/);
    expect(svg).toMatch(/<text [^>]*fill="#aa00bb"[^>]*>OPS<\/text>/);
  });

  test('escapes XML-special characters in the text body', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, textStyle('a&<b'));
    expect(svg).toContain('>a&amp;&lt;b</text>');
    expect(svg).not.toContain('>a&<b<');
  });

  test('renders carved rect + icon + text when both are present', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, {
      ...DEFAULT_STYLE,
      centerIcon: findCenterIcon('heart'),
      centerText: 'v2',
    });
    expect(svg).toMatch(/<g transform="translate\(/);
    expect(svg).toMatch(/<text [^>]*>v2<\/text>/);
    // Overlay sits after the modules path.
    const pathIdx = svg.indexOf('<path ');
    expect(svg.indexOf('<text')).toBeGreaterThan(pathIdx);
  });

  test('embeds Orbitron @font-face only when centerText is present', () => {
    const qr = generateQr(valid('hello'));
    // No text → no font embed (icon-only exports stay small).
    expect(qrToSvgString(qr, DEFAULT_STYLE)).not.toContain('@font-face');
    expect(
      qrToSvgString(qr, { ...DEFAULT_STYLE, centerIcon: findCenterIcon('heart') }),
    ).not.toContain('@font-face');
    // With text → font face inlined as data URL.
    const withText = qrToSvgString(qr, { ...DEFAULT_STYLE, centerText: 'OPS' });
    expect(withText).toContain('<defs><style>');
    expect(withText).toContain('@font-face');
    expect(withText).toContain("font-family:'Orbitron'");
    expect(withText).toContain('font-weight:700');
    expect(withText).toContain('src:url(data:font/woff2;base64,');
  });

  test('font defs appear before the modules path so the font is resolved by rendering time', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, { ...DEFAULT_STYLE, centerText: 'OPS' });
    const defsIdx = svg.indexOf('<defs>');
    const pathIdx = svg.indexOf('<path ');
    expect(defsIdx).toBeGreaterThan(-1);
    expect(defsIdx).toBeLessThan(pathIdx);
  });
});
