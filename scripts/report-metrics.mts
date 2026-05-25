/**
 * Prints the headline field-robustness numbers as markdown to stdout.
 *
 * UNLIKE docs/TEST-REPORT.md, this output is intentionally NOT committed: the
 * percentages depend on the platform's sharp/libvips build, so they drift a
 * point or two macOS↔Linux. CI pipes this into the GitHub Actions job summary,
 * where per-run, environment-correct numbers belong. Run locally with
 * `npm run report:metrics` to see them.
 */
import sharp from 'sharp';
import { validatePayload } from '../src/lib/payload.ts';
import { generateQr, qrToSvgString, DEFAULT_STYLE, type QrStyle } from '../src/lib/qr.ts';
import { findCenterIcon } from '../src/lib/center-icons.ts';
import { DECODERS } from '../tests/scannability/decoders.ts';
import {
  shrink,
  blur,
  lowContrast,
  shear,
  rotate,
  jpeg,
  glare,
  noise,
  occlusion,
  perspective,
  type Rgba,
} from '../tests/scannability/stress.ts';

const PAYLOAD = 'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar';
const BG = { r: 240, g: 237, b: 226, alpha: 1 };
const HEART = findCenterIcon('heart');
const ICON = { id: 'heart', innerSvg: HEART.innerSvg } as const;

const BATTERY: ((m: Buffer) => Promise<Rgba>)[] = [
  (m) => shrink(m, 110),
  (m) => shrink(m, 72),
  (m) => blur(m, 2),
  (m) => blur(m, 3.5),
  (m) => lowContrast(m, 0.27),
  (m) => shear(m, 0.4),
  (m) => rotate(m, 20),
  (m) => jpeg(m, 25),
  (m) => glare(m, 0.85),
  (m) => noise(m, 30),
  (m) => occlusion(m, 0.18),
  (m) => perspective(m, 0.12),
];

function styleFor(
  moduleShape: QrStyle['moduleShape'],
  finderShape: QrStyle['finderShape'],
  withIcon: boolean,
): QrStyle {
  return { ...DEFAULT_STYLE, moduleShape, finderShape, ...(withIcon ? { centerIcon: ICON } : {}) };
}

async function robustness(style: QrStyle): Promise<number> {
  const v = validatePayload(PAYLOAD);
  if (!v.ok) throw new Error('invalid payload');
  const master = await sharp(Buffer.from(qrToSvgString(generateQr(v.value), style)), {
    density: 600,
  })
    .resize(1024, 1024, { fit: 'contain', background: BG })
    .png()
    .toBuffer();
  let ok = 0;
  let total = 0;
  for (const apply of BATTERY) {
    const img = await apply(master);
    for (const decoder of DECODERS) {
      total++;
      const r = await decoder.fn(img.rgba, img.width, img.height);
      if (r.ok && r.text === PAYLOAD) ok++;
    }
  }
  return ok / total;
}

const CONFIGS: { name: string; style: QrStyle }[] = [
  { name: 'square / square (baseline)', style: styleFor('square', 'square', false) },
  { name: 'dot · circle · icon', style: styleFor('dot', 'circle', true) },
  { name: 'dot · square · icon', style: styleFor('dot', 'square', true) },
  { name: 'h-pill · rounded', style: styleFor('horizontal-pill', 'rounded', false) },
  { name: 'v-pill · chamfer', style: styleFor('vertical-pill', 'chamfer', false) },
  { name: 'rounded · circle · icon', style: styleFor('rounded', 'circle', true) },
  { name: 'chamfer · chamfer · icon', style: styleFor('chamfer', 'chamfer', true) },
];

const lines = [
  '### Field robustness (this run)',
  '',
  '| Configuration | Robustness |',
  '| --- | ---: |',
];
for (const { name, style } of CONFIGS) {
  const score = await robustness(style);
  lines.push(`| ${name} | ${(score * 100).toFixed(0)}% |`);
}
lines.push(
  '',
  `> Decode success over ${String(BATTERY.length)} field degradations × ${String(DECODERS.length)} engines, dense payload. Varies slightly by platform; not committed (see docs/TEST-REPORT.md for the stable report).`,
);
// eslint-disable-next-line no-console
console.log(lines.join('\n'));
