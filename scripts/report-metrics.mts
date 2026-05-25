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
import {
  generateQr,
  qrToSvgString,
  styleHasOverlay,
  MIN_OVERLAY_VERSION,
  type QrStyle,
} from '../src/lib/qr.ts';
import { DECODERS } from '../tests/scannability/decoders.ts';
import { STANDARD_BATTERY } from '../tests/scannability/stress.ts';
import { styleFor } from '../tests/scannability/matrix.ts';

const PAYLOAD = 'https://www.anthropic.com/research/very/long/path/with-many/segments?foo=bar';
const BG = { r: 240, g: 237, b: 226, alpha: 1 };

async function robustness(style: QrStyle): Promise<number> {
  const v = validatePayload(PAYLOAD);
  if (!v.ok) throw new Error('invalid payload');
  const qr = generateQr(
    v.value,
    styleHasOverlay(style) ? { minVersion: MIN_OVERLAY_VERSION } : undefined,
  );
  const master = await sharp(Buffer.from(qrToSvgString(qr, style)), {
    density: 600,
  })
    .resize(1024, 1024, { fit: 'contain', background: BG })
    .png()
    .toBuffer();
  let ok = 0;
  let total = 0;
  for (const apply of STANDARD_BATTERY) {
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
  { name: 'square / square (baseline)', style: styleFor('square', 'square', 'none') },
  { name: 'dot · circle · icon', style: styleFor('dot', 'circle', 'icon') },
  { name: 'dot · square · icon', style: styleFor('dot', 'square', 'icon') },
  { name: 'h-pill · rounded', style: styleFor('horizontal-pill', 'rounded', 'none') },
  { name: 'v-pill · chamfer', style: styleFor('vertical-pill', 'chamfer', 'none') },
  { name: 'rounded · circle · icon', style: styleFor('rounded', 'circle', 'icon') },
  { name: 'chamfer · chamfer · icon', style: styleFor('chamfer', 'chamfer', 'icon') },
  { name: 'dot · square · text', style: styleFor('dot', 'square', 'text') },
  { name: 'rounded · circle · both', style: styleFor('rounded', 'circle', 'both') },
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
  `> Decode success over ${String(STANDARD_BATTERY.length)} field degradations × ${String(DECODERS.length)} engines, dense payload. Varies slightly by platform; not committed (see docs/TEST-REPORT.md for the stable report).`,
);
// eslint-disable-next-line no-console
console.log(lines.join('\n'));
