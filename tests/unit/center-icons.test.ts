import { describe, expect, test } from 'vitest';
import {
  CENTER_ICONS,
  NONE_ICON,
  findCenterIcon,
  type CenterIconId,
} from '../../src/lib/center-icons';
import {
  CENTER_ICON_SIZE_RATIO,
  CENTER_ICON_PAD_MODULES,
  DEFAULT_STYLE,
  QUIET_ZONE,
  centerIconLayout,
  generateQr,
  qrToSvgString,
} from '../../src/lib/qr';
import { validatePayload, type ValidatedPayload } from '../../src/lib/payload';

function valid(s: string): ValidatedPayload {
  const r = validatePayload(s);
  if (!r.ok) throw new Error(`validation should succeed for fixture: ${s}`);
  return r.value;
}

describe('CENTER_ICONS catalog', () => {
  test('contains 21 entries (20 icons + None)', () => {
    expect(CENTER_ICONS.length).toBe(21);
  });

  test('first entry is the no-op None option with empty innerSvg', () => {
    expect(CENTER_ICONS[0]?.id).toBe('none');
    expect(CENTER_ICONS[0]?.innerSvg).toBe('');
  });

  test('every non-None icon has non-empty innerSvg and a label', () => {
    for (const icon of CENTER_ICONS) {
      if (icon.id === 'none') continue;
      expect(icon.innerSvg.length).toBeGreaterThan(0);
      expect(icon.label.length).toBeGreaterThan(0);
    }
  });

  test('every non-None icon uses currentColor (so it inherits foreground)', () => {
    // The whole point of the catalog is that one source paints in any color.
    // If an agent slipped in a hardcoded fill we want to catch it now.
    for (const icon of CENTER_ICONS) {
      if (icon.id === 'none') continue;
      expect(icon.innerSvg, `${icon.id} must reference currentColor`).toContain('currentColor');
    }
  });

  test('no icon contains a stroke attribute (would vanish at 40px render size)', () => {
    for (const icon of CENTER_ICONS) {
      if (icon.id === 'none') continue;
      expect(icon.innerSvg, `${icon.id} must not use stroke`).not.toMatch(/\bstroke=/);
    }
  });

  test('inner contents do not include the outer <svg> wrapper', () => {
    for (const icon of CENTER_ICONS) {
      if (icon.id === 'none') continue;
      expect(icon.innerSvg).not.toContain('<svg');
      expect(icon.innerSvg).not.toContain('</svg>');
    }
  });

  test('icon ids are unique', () => {
    const ids = new Set(CENTER_ICONS.map((i) => i.id));
    expect(ids.size).toBe(CENTER_ICONS.length);
  });

  test('findCenterIcon returns the correct entry by id', () => {
    expect(findCenterIcon('heart').label).toBe('Heart');
    expect(findCenterIcon('none')).toBe(NONE_ICON);
  });

  test('findCenterIcon throws for an unknown id', () => {
    expect(() => findCenterIcon('not-a-real-icon' as CenterIconId)).toThrow();
  });
});

describe('centerIconLayout', () => {
  test('icon side is CENTER_ICON_SIZE_RATIO of the QR matrix side', () => {
    const layout = centerIconLayout(25);
    expect(layout.iconSize).toBeCloseTo(25 * CENTER_ICON_SIZE_RATIO);
  });

  test('icon stays comfortably under the 25% area ceiling for H error correction', () => {
    // Area-based safety check: icon coverage of QR matrix area must be <7%.
    // (The H level practical ceiling is ~25% area; we want lots of headroom.)
    const layout = centerIconLayout(25);
    const matrixArea = 25 * 25;
    const iconArea = layout.iconSize * layout.iconSize;
    expect(iconArea / matrixArea).toBeLessThan(0.07);
  });

  test('layout is centered on the QR including its quiet zone', () => {
    const layout = centerIconLayout(25);
    const total = 25 + QUIET_ZONE * 2;
    const center = total / 2;
    expect(layout.iconX + layout.iconSize / 2).toBeCloseTo(center);
    expect(layout.iconY + layout.iconSize / 2).toBeCloseTo(center);
    expect(layout.padX + layout.padSize / 2).toBeCloseTo(center);
    expect(layout.padY + layout.padSize / 2).toBeCloseTo(center);
  });

  test('backing pad extends beyond the icon on every side', () => {
    const layout = centerIconLayout(25);
    expect(layout.padSize).toBeCloseTo(layout.iconSize + CENTER_ICON_PAD_MODULES * 2);
    expect(layout.padX).toBeLessThan(layout.iconX);
    expect(layout.padY).toBeLessThan(layout.iconY);
  });
});

describe('qrToSvgString — with center icon', () => {
  const heartStyle = () => ({
    ...DEFAULT_STYLE,
    centerIcon: findCenterIcon('heart'),
  });

  test('omits the overlay entirely when centerIcon is null', () => {
    const qr = generateQr(valid('hello'));
    const baseline = qrToSvgString(qr, DEFAULT_STYLE);
    expect(baseline).not.toContain('<g transform=');
  });

  test('embeds the icon as a translated/scaled <g> with the foreground color', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, { ...heartStyle(), foreground: '#ff0000' });
    expect(svg).toMatch(
      /<g transform="translate\([\d.]+ [\d.]+\) scale\([\d.]+\)" color="#ff0000">/,
    );
  });

  test('embeds the backing pad rect in the background color', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, { ...heartStyle(), background: '#00ff00' });
    // The QR's own background rect uses the same color, but the overlay rect
    // is the only one with both x= and y= attributes (the canvas rect omits them).
    expect(svg).toMatch(
      /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#00ff00"\/>/,
    );
  });

  test('includes the icon innerSvg verbatim', () => {
    const qr = generateQr(valid('hello'));
    const icon = findCenterIcon('heart');
    const svg = qrToSvgString(qr, heartStyle());
    expect(svg).toContain(icon.innerSvg);
  });

  test('overlay sits after the matrix path so it paints on top', () => {
    const qr = generateQr(valid('hello'));
    const svg = qrToSvgString(qr, heartStyle());
    const pathIdx = svg.indexOf('<path ');
    const overlayIdx = svg.indexOf('<g transform=');
    expect(pathIdx).toBeGreaterThan(-1);
    expect(overlayIdx).toBeGreaterThan(pathIdx);
  });
});
