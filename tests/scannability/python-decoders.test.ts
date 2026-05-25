/**
 * @vitest-environment node
 *
 * "Real platform" decode layer — OpenCV + WeChat, run from a project-local
 * Python venv. These are decoder lineages the JS/wasm engines (jsQR, ZXing,
 * ZBar) don't represent:
 *
 *   - cv2.QRCodeDetector — OpenCV's classic geometric detector. Strict about
 *     finder geometry, so it's the canary for "did a shape break the locator
 *     ratio for a conventional CV pipeline".
 *   - cv2.wechat_qrcode  — WeChat's CNN-based detector (a billion-user mobile
 *     scanner). The closest offline proxy we have for "will it scan in the
 *     wild on the dominant non-Apple/Google scanner".
 *
 * GATED: this suite self-skips unless the venv exists and `cv2` imports, so it
 * is rigorous-by-default where the tooling is present and harmless in CI where
 * it isn't. Set it up once with `npm run setup:decoders:py`; run it in
 * isolation with `npm run test:decoders:py`.
 *
 * Policy is detector-aware because the two engines have very different
 * tolerances, established empirically (see thresholds below):
 *   - WeChat must read EVERY combination at a typical (short) payload, and the
 *     overwhelming majority at a dense (long) payload.
 *   - The classic detector is only required to read SQUARE-finder combinations
 *     (it provably cannot read our shaped finders — a documented, accepted
 *     limitation, surfaced via console summary rather than asserted away).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { renderMatrixToDir, manifestOf, type Combo } from './matrix';

const PY = join(process.cwd(), '.venv', 'bin', 'python');
const SCRIPT = join(process.cwd(), 'tools', 'decoders', 'decode_qr.py');

/** The venv is usable only if the interpreter exists and cv2 imports. */
function pythonDecodersAvailable(): boolean {
  if (!existsSync(PY) || !existsSync(SCRIPT)) return false;
  const probe = spawnSync(PY, ['-c', 'import cv2'], { encoding: 'utf-8' });
  return probe.status === 0;
}

const AVAILABLE = pythonDecodersAvailable();
const describeMaybe = AVAILABLE ? describe : describe.skip;

if (!AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    '[python-decoders] skipped — run `npm run setup:decoders:py` to enable the OpenCV/WeChat layer.',
  );
}

type DecodeRow = {
  path: string;
  expect: string;
  qrcode_detector: string | null;
  wechat: string | null;
};

describeMaybe('real-platform decoders — OpenCV + WeChat', () => {
  let combos: Combo[] = [];
  let rows: DecodeRow[] = [];
  const byPath = new Map<string, DecodeRow>();

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qrcodr-py-'));
    combos = await renderMatrixToDir(dir);

    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, manifestOf(combos));
    const stdout = execFileSync(PY, [SCRIPT, manifestPath], {
      encoding: 'utf-8',
      maxBuffer: 1e8,
    });
    rows = JSON.parse(stdout) as DecodeRow[];
    for (const r of rows) byPath.set(r.path, r);

    // Surface the cross-engine coverage so a CI log shows the real picture.
    const wechatOk = rows.filter((r) => r.wechat === r.expect).length;
    const classicOk = rows.filter((r) => r.qrcode_detector === r.expect).length;
    // eslint-disable-next-line no-console
    console.log(
      `[python-decoders] WeChat ${String(wechatOk)}/${String(rows.length)}, classic ${String(classicOk)}/${String(rows.length)}`,
    );
  }, 120_000);

  const ok = (c: Combo, engine: 'wechat' | 'qrcode_detector'): boolean => {
    const r = byPath.get(c.path);
    return !!r && r[engine] === c.expect;
  };

  it('WeChat decodes every combination at a typical (short) payload', () => {
    const short = combos.filter((c) => c.payloadKind === 'short');
    const failed = short.filter((c) => !ok(c, 'wechat')).map((c) => c.label);
    expect(failed, `WeChat failed short-payload combos: ${failed.join(', ')}`).toEqual([]);
  });

  it('WeChat decodes the overwhelming majority at a dense (long) payload', () => {
    const long = combos.filter((c) => c.payloadKind === 'long');
    const passed = long.filter((c) => ok(c, 'wechat')).length;
    const rate = passed / long.length;
    // Measured ~94% (only a couple dense + heavily-shaped combos slip). Floor at
    // 0.85 catches a real regression while tolerating those known edge cases.
    expect(rate, `WeChat long-payload rate ${(rate * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(
      0.85,
    );
  });

  it('classic OpenCV detector reads all square-finder combinations', () => {
    const squareFinder = combos.filter((c) => c.finderShape === 'square');
    const failed = squareFinder.filter((c) => !ok(c, 'qrcode_detector')).map((c) => c.label);
    expect(
      failed,
      `classic QRCodeDetector failed square-finder combos: ${failed.join(', ')}`,
    ).toEqual([]);
  });

  it('every combination is read by at least one OpenCV-family engine at short payload', () => {
    const short = combos.filter((c) => c.payloadKind === 'short');
    const failed = short
      .filter((c) => !ok(c, 'wechat') && !ok(c, 'qrcode_detector'))
      .map((c) => c.label);
    expect(failed, `unreadable by both OpenCV engines: ${failed.join(', ')}`).toEqual([]);
  });
});
