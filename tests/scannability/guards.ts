/**
 * Single source of truth for the scannability + E2E guard thresholds.
 *
 * Imported by the test files that enforce them AND by the test-report
 * generator (`scripts/generate-test-report.mts`). Keeping the numbers here —
 * rather than inline in each test — is what lets `docs/TEST-REPORT.md` document
 * the real guarantees without drifting from them: change a threshold and both
 * the test and the regenerated report move together (CI fails the build if the
 * committed report is stale).
 *
 * These are all stable constants, not measurements, so they are identical on
 * every machine — the report stays deterministic across macOS/Linux.
 */
export const GUARDS = {
  /** finder-shapes: shaped finders must scan within this of the square baseline. */
  finderShapeMargin: 0.1,
  /** combinations (clean): min engines (of 4) that must decode each combo. */
  cleanQuorum: 3,
  /** combinations (field): margin below the square baseline a combo may sit. */
  combosMargin: 0.2,
  /** combinations (field) + E2E: absolute robustness floor (no combo collapses). */
  robustnessFloor: 0.4,
  /** E2E: the canvas PNG must scan within this of the canonical SVG. */
  pngSvgParityMargin: 0.15,
  /**
   * overlay-budget: max fraction of the symbol area the center-overlay backing
   * plate may occupy. The plate knocks out the modules under it, so this is a
   * direct error-correction-budget cap. The app's worst case (icon+text at
   * MIN_OVERLAY_VERSION) sits at ~9.3%; this 12% ceiling catches a regression
   * that enlarges the overlay while staying well below the measured ~25–30%
   * decode cliff (both bounds asserted in `overlay-budget`).
   */
  overlayAreaCeiling: 0.12,
} as const;

/** Render a 0..1 fraction as a whole-percent string (e.g. 0.1 → "10%"). */
export function pct(fraction: number): string {
  return `${String(Math.round(fraction * 100))}%`;
}
