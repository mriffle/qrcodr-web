/**
 * @vitest-environment node
 *
 * "Real platform" decode layer — Apple Vision (`tools/apple-vision/decode_qr.swift`).
 *
 * VNDetectBarcodesRequest is the actual detector iOS Camera / macOS use, so this
 * is the highest-fidelity "will it scan on an iPhone" check we can run without a
 * physical device — it feeds our exported PNGs straight to Vision, bypassing
 * only the camera. Measured 100% across the whole module × finder × overlay ×
 * payload matrix, so the bar is set high: Vision is the most capable engine in
 * the suite (cf. WeChat ~97%, classic OpenCV ~27%).
 *
 * GATED: self-skips unless running on macOS with a working `swift` toolchain
 * (so the default `npm run test` exercises it on a Mac and harmlessly skips it
 * on Linux). On CI it runs as a dedicated `macos-latest` job
 * (`npm run test:vision:apple`).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { renderMatrixToDir, manifestOf, type Combo } from './matrix';

const SCRIPT = join(process.cwd(), 'tools', 'apple-vision', 'decode_qr.swift');

/** Vision is only available on macOS with a usable Swift toolchain. */
function appleVisionAvailable(): boolean {
  if (process.platform !== 'darwin' || !existsSync(SCRIPT)) return false;
  return spawnSync('swift', ['--version'], { encoding: 'utf-8' }).status === 0;
}

// Skip dynamically (in the test bodies), NOT via `describe.skip`: a static skip
// is invisible to `vitest list`, which would drop this file's count to 0 on a
// non-macOS machine and break the report freshness check. Plain `describe` +
// runtime `ctx.skip()` keeps the count stable while still not running off-Mac.
const AVAILABLE = appleVisionAvailable();

if (!AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn('[apple-vision] skipped — requires macOS with a `swift` toolchain.');
}

type VisionRow = { path: string; expect: string; vision: string | null };

describe('real-platform decoder — Apple Vision', () => {
  let combos: Combo[] = [];
  const byPath = new Map<string, VisionRow>();

  beforeAll(async () => {
    if (!AVAILABLE) return;
    const dir = mkdtempSync(join(tmpdir(), 'qrcodr-vision-'));
    combos = await renderMatrixToDir(dir);

    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, manifestOf(combos));
    // `swift <file>` compiles then runs the script; one batch invocation.
    const stdout = execFileSync('swift', [SCRIPT, manifestPath], {
      encoding: 'utf-8',
      maxBuffer: 1e8,
    });
    const rows = JSON.parse(stdout) as VisionRow[];
    for (const r of rows) byPath.set(r.path, r);

    const okCount = rows.filter((r) => r.vision === r.expect).length;
    // eslint-disable-next-line no-console
    console.log(`[apple-vision] Vision ${String(okCount)}/${String(rows.length)}`);
  }, 120_000);

  const decoded = (c: Combo): boolean => byPath.get(c.path)?.vision === c.expect;

  it('Vision decodes every combination at a typical (short) payload', (ctx) => {
    if (!AVAILABLE) return ctx.skip();
    const short = combos.filter((c) => c.payloadKind === 'short');
    const failed = short.filter((c) => !decoded(c)).map((c) => c.label);
    expect(failed, `Vision failed short-payload combos: ${failed.join(', ')}`).toEqual([]);
  });

  it('Vision decodes (nearly) every combination at a dense (long) payload', (ctx) => {
    if (!AVAILABLE) return ctx.skip();
    const long = combos.filter((c) => c.payloadKind === 'long');
    const passed = long.filter(decoded).length;
    const rate = passed / long.length;
    // Measured 100%. Floor at 0.95 leaves a hair of room for cross-OS-version
    // model drift while still failing a real regression.
    expect(rate, `Vision long-payload rate ${(rate * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(
      0.95,
    );
  });
});
