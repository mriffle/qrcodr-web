/**
 * Generates docs/TEST-REPORT.md — the committed, README-linked test report.
 *
 * Design constraint: the output must be DETERMINISTIC across machines, because
 * CI regenerates it and fails the build if the committed copy differs
 * (`npm run report:check`). So this file contains only stable content:
 *
 *   - test inventory (counts come from `vitest list` / `playwright --list`,
 *     which collect tests without executing the bodies — no decode work, no
 *     libvips/canvas output, so counts are identical everywhere),
 *   - the guard thresholds (constants from tests/scannability/guards.ts),
 *   - the decoder panel and degradation battery (structural lists),
 *   - characterized cross-engine behavior (stable qualitative facts).
 *
 * It deliberately omits the precise measured robustness percentages (which
 * drift macOS↔Linux); those are published to the GitHub Actions job summary
 * on each run. No timestamps either — they'd defeat the freshness check.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GUARDS, pct } from '../tests/scannability/guards.ts';
import { DECODERS } from '../tests/scannability/decoders.ts';
import { FAMILIES } from '../tests/scannability/stress.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'TEST-REPORT.md');

type VitestEntry = { name: string; file: string };

/** Collect vitest test counts per file WITHOUT running the bodies. */
function vitestCounts(): Map<string, number> {
  const json = execFileSync('npx', ['vitest', 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 1e8,
  });
  const entries = JSON.parse(json) as VitestEntry[];
  const byFile = new Map<string, number>();
  for (const e of entries) {
    const key = e.file.replace(`${ROOT}/`, '');
    byFile.set(key, (byFile.get(key) ?? 0) + 1);
  }
  return byFile;
}

/** Collect the Playwright E2E test count from `--list` (no webServer/run). */
function playwrightCount(): number {
  const out = execFileSync('npx', ['playwright', 'test', '--list'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 1e8,
  });
  const m = /Total:\s+(\d+)\s+tests?/.exec(out);
  return m ? Number(m[1]) : 0;
}

function sumWhere(counts: Map<string, number>, predicate: (file: string) => boolean): number {
  let total = 0;
  for (const [file, n] of counts) if (predicate(file)) total += n;
  return total;
}

// Role descriptions for the decoder panel, keyed by the name in DECODERS so the
// engine list itself stays sourced from code.
const DECODER_ROLE: Record<string, { kind: string; where: string; role: string }> = {
  jsQR: { kind: 'Pure JS', where: 'in-process', role: 'Reference web scanner' },
  'ZXing-JS': { kind: 'Pure JS', where: 'in-process', role: 'ZXing JS port (TRY_HARDER)' },
  'ZXing-wasm': {
    kind: 'wasm (C++)',
    where: 'in-process',
    role: 'The zxing-cpp engine real native apps embed',
  },
  ZBar: { kind: 'wasm', where: 'in-process', role: 'Ubiquitous embedded/Linux scanner' },
};

// The real-platform engines live behind gated layers, not in DECODERS.
const NATIVE_ENGINES = [
  {
    name: 'OpenCV QRCodeDetector',
    kind: 'native (C++)',
    where: '.venv (gated)',
    role: "OpenCV's classic geometric detector",
  },
  {
    name: 'WeChat (cv2.wechat_qrcode)',
    kind: 'native (CNN)',
    where: '.venv (gated)',
    role: 'Offline proxy for the dominant mobile scanner',
  },
  {
    name: 'Apple Vision (VNDetectBarcodesRequest)',
    kind: 'native (Vision)',
    where: 'macOS job (gated)',
    role: 'The actual iOS Camera / macOS QR detector',
  },
];

// What each degradation family models, keyed by FAMILIES[].name.
const FAMILY_MODELS: Record<string, string> = {
  shrink: 'Scanning from a distance',
  blur: 'Out-of-focus / motion',
  contrast: 'Faded print, glare, dim screen',
  shear: 'Off-axis viewing angle (affine)',
  rotate: 'Tilted camera',
  jpeg: 'Screenshot / messaging recompression',
  glare: 'Specular reflection off a screen',
  noise: 'Low-light sensor grain (seeded)',
  occlusion: 'Finger / sticker over data modules',
  perspective: 'True off-axis foreshortening (homography)',
};

function table(headers: string[], align: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${align.join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

function build(): string {
  const vc = vitestCounts();
  const unit = sumWhere(vc, (f) => f.startsWith('tests/unit/'));
  const finder = vc.get('tests/scannability/finder-shapes.test.ts') ?? 0;
  const combos = vc.get('tests/scannability/combinations.test.ts') ?? 0;
  const python = vc.get('tests/scannability/python-decoders.test.ts') ?? 0;
  const vision = vc.get('tests/scannability/apple-vision.test.ts') ?? 0;
  const e2e = playwrightCount();
  const total = unit + finder + combos + python + vision + e2e;

  const inventory = table(
    ['Layer', 'Suite', 'Tests'],
    ['---', '---', '---:'],
    [
      ['Unit & component', '`tests/unit`', String(unit)],
      ['Scannability · finder/alignment shapes', '`finder-shapes`', String(finder)],
      ['Scannability · combinatorial matrix', '`combinations`', String(combos)],
      ['Real-platform OpenCV/WeChat (gated)', '`python-decoders`', String(python)],
      ['Real-platform Apple Vision (macOS, gated)', '`apple-vision`', String(vision)],
      ['End-to-end · Playwright (3 browsers)', '`generate-and-download`', String(e2e)],
      ['**Total**', '', `**${String(total)}**`],
    ],
  );

  const panel = table(
    ['Engine', 'Kind', 'Runs in', 'Role'],
    ['---', '---', '---', '---'],
    [
      ...DECODERS.map((d) => {
        const r = DECODER_ROLE[d.name] ?? { kind: '—', where: 'in-process', role: '—' };
        return [d.name, r.kind, r.where, r.role];
      }),
      ...NATIVE_ENGINES.map((e) => [e.name, e.kind, e.where, e.role]),
    ],
  );

  const battery = table(
    ['Family', 'Levels', 'Easiest → hardest', 'Models'],
    ['---', '---:', '---', '---'],
    FAMILIES.map((f) => {
      const first = f.levels[0];
      const last = f.levels[f.levels.length - 1];
      const span =
        first === undefined || last === undefined ? '—' : `${f.label(first)} → ${f.label(last)}`;
      return [f.name, String(f.levels.length), span, FAMILY_MODELS[f.name] ?? '—'];
    }),
  );

  const guards = table(
    ['Guard', 'Threshold', 'Enforced by'],
    ['---', '---', '---'],
    [
      [
        'Shaped finders vs square baseline',
        `within ${pct(GUARDS.finderShapeMargin)}`,
        '`finder-shapes`',
      ],
      [
        'Combinatorial clean decode',
        `≥ ${String(GUARDS.cleanQuorum)} of ${String(DECODERS.length)} engines`,
        '`combinations`',
      ],
      [
        'High-risk combos vs square baseline',
        `within ${pct(GUARDS.combosMargin)}`,
        '`combinations`',
      ],
      ['Absolute robustness floor', `≥ ${pct(GUARDS.robustnessFloor)}`, '`combinations`, e2e'],
      ['Canvas PNG vs canonical SVG parity', `within ${pct(GUARDS.pngSvgParityMargin)}`, 'e2e'],
    ],
  );

  const crossEngine = table(
    ['Engine', 'Characterized behavior'],
    ['---', '---'],
    [
      ['jsQR', 'Mis-reads `dot` modules under `chamfer` finders'],
      ['ZXing-JS / ZXing-wasm', 'Robust across every shipping combination'],
      ['ZBar', 'Tougher on `circle` finders behind a center icon; weaker on dense codes'],
      ['OpenCV (classic)', 'Reads square finders only — rejects every shaped finder'],
      ['WeChat', 'Reads every combination except a few dense + heavily-shaped ones'],
      ['Apple Vision', 'Reads every shipping combination — the most capable engine in the suite'],
    ],
  );

  return `# QR Code Test Report

<!-- GENERATED FILE — do not edit by hand. Run \`npm run report\` to regenerate.
     CI fails the build if this file is stale (\`npm run report:check\`).
     Contains only deterministic content; precise per-run robustness percentages
     are published to the GitHub Actions job summary, not committed here. -->

These QR codes are tested for **readability**, not just byte round-tripping: the
real exported artifacts are stressed under simulated field conditions and
decoded with several independent engines — including the detectors real phones
and apps actually use.

## Test inventory

${inventory}

Counts are collected with \`vitest list\` / \`playwright --list\` (tests are
enumerated, not executed), so they are identical on every machine. The E2E count
is test _runs_: the full suite on Chromium plus the canvas/PNG-export subset
re-run on Firefox and WebKit (where the browser's SVG→canvas rasterizer differs).

## Decoder panel

Each scannability decode is checked against engines with different
finder-detection lineages, so a shape that fools one detector can't slip through:

${panel}

The native layers are **gated** — OpenCV/WeChat self-skips unless the
project-local \`.venv\` is present (\`npm run setup:decoders:py\`), and Apple
Vision self-skips unless run on macOS with a Swift toolchain (a dedicated
\`macos-latest\` CI job).

## Field-degradation battery

Before decoding, each artifact is pushed through transforms that model how a
camera mangles a code in the wild:

${battery}

## Guards (enforced thresholds)

The suite fails if a shape, combination, or export pipeline regresses past these
field-reliability thresholds:

${guards}

## Characterized cross-engine behavior

Established, stable findings the suite encodes (e.g. the clean matrix requires a
${String(GUARDS.cleanQuorum)}-of-${String(DECODERS.length)} quorum precisely because each engine has one blind spot):

${crossEngine}

## Running the suite

\`\`\`bash
npm run check            # format + lint + typecheck + unit/scannability tests
npm run test:e2e         # Playwright: real exports, clean + field-stress decode
npm run setup:decoders:py && npm run test:decoders:py   # OpenCV/WeChat layer
npm run report           # regenerate this document
\`\`\`

Precise per-run robustness percentages (which vary slightly by platform) are
printed in the test logs and published to the GitHub Actions run summary.
`;
}

const markdown = build();
writeFileSync(OUT, markdown);
// eslint-disable-next-line no-console
console.log(`wrote ${OUT.replace(`${ROOT}/`, '')}`);
