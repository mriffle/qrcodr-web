import { describe, expect, test } from 'vitest';
import { DEFAULT_STYLE, QUIET_ZONE, generateQr, qrToSvgString } from '../../src/lib/qr';
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
});
