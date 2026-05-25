# QR Code Test Report

<!-- GENERATED FILE — do not edit by hand. Run `npm run report` to regenerate.
     CI fails the build if this file is stale (`npm run report:check`).
     Contains only deterministic content; precise per-run robustness percentages
     are published to the GitHub Actions job summary, not committed here. -->

These QR codes are tested for **readability**, not just byte round-tripping: the
real exported artifacts are stressed under simulated field conditions and
decoded with several independent engines — including the detectors real phones
and apps actually use.

## Test inventory

| Layer                                     | Suite                                     |   Tests |
| ----------------------------------------- | ----------------------------------------- | ------: |
| Unit & component                          | `tests/unit`                              |     144 |
| Scannability · finder/alignment shapes    | `finder-shapes`                           |       2 |
| Scannability · combinatorial matrix       | `combinations`                            |      97 |
| Scannability · center-overlay budget      | `overlay-budget`                          |       3 |
| Real-platform OpenCV/WeChat (gated)       | `python-decoders`                         |       4 |
| Real-platform Apple Vision (macOS, gated) | `apple-vision`                            |       2 |
| End-to-end · Playwright (3 browsers)      | `generate-and-download` · `canvas-vision` |     254 |
| **Total**                                 |                                           | **506** |

Counts are collected with `vitest list` / `playwright --list` (tests are
enumerated, not executed), so they are identical on every machine. The E2E count
is test _runs_: the full suite on Chromium plus the canvas/PNG-export subset
re-run on Firefox and WebKit (where the browser's SVG→canvas rasterizer differs).

## Decoder panel

Each scannability decode is checked against engines with different
finder-detection lineages, so a shape that fools one detector can't slip through:

| Engine                                 | Kind            | Runs in           | Role                                          |
| -------------------------------------- | --------------- | ----------------- | --------------------------------------------- |
| jsQR                                   | Pure JS         | in-process        | Reference web scanner                         |
| ZXing-JS                               | Pure JS         | in-process        | ZXing JS port (TRY_HARDER)                    |
| ZXing-wasm                             | wasm (C++)      | in-process        | The zxing-cpp engine real native apps embed   |
| ZBar                                   | wasm            | in-process        | Ubiquitous embedded/Linux scanner             |
| OpenCV QRCodeDetector                  | native (C++)    | .venv (gated)     | OpenCV's classic geometric detector           |
| WeChat (cv2.wechat_qrcode)             | native (CNN)    | .venv (gated)     | Offline proxy for the dominant mobile scanner |
| Apple Vision (VNDetectBarcodesRequest) | native (Vision) | macOS job (gated) | The actual iOS Camera / macOS QR detector     |

The native layers are **gated** — OpenCV/WeChat self-skips unless the
project-local `.venv` is present (`npm run setup:decoders:py`), and Apple
Vision self-skips unless run on macOS with a Swift toolchain (a dedicated
`macos-latest` CI job).

Apple Vision additionally decodes the **real browser-`<canvas>` PNG exports**
(not just sharp-rasterized SVGs) in a dedicated macOS Playwright job
(`canvas-vision`), where Playwright's WebKit is Apple WebKit — the closest
proxy to "does an iPhone read the file the user actually downloads" short of a
physical device.

## Field-degradation battery

Before decoding, each artifact is pushed through transforms that model how a
camera mangles a code in the wild:

| Family      | Levels | Easiest → hardest | Models                                    |
| ----------- | -----: | ----------------- | ----------------------------------------- |
| shrink      |     11 | 220px → 50px      | Scanning from a distance                  |
| blur        |     12 | σ0.5 → σ8         | Out-of-focus / motion                     |
| contrast    |     10 | 100% → 8%         | Faded print, glare, dim screen            |
| shear       |      9 | 0 → 0.9           | Off-axis viewing angle (affine)           |
| rotate      |      7 | 0° → 45°          | Tilted camera                             |
| jpeg        |      8 | q90 → q8          | Screenshot / messaging recompression      |
| glare       |      7 | 20% → 98%         | Specular reflection off a screen          |
| noise       |      7 | σ10 → σ100        | Low-light sensor grain (seeded)           |
| occlusion   |      6 | 5% → 30%          | Finger / sticker over data modules        |
| perspective |      7 | 0.05 → 0.44       | True off-axis foreshortening (homography) |

## Guards (enforced thresholds)

The suite fails if a shape, combination, or export pipeline regresses past these
field-reliability thresholds:

| Guard                               | Threshold        | Enforced by         |
| ----------------------------------- | ---------------- | ------------------- |
| Shaped finders vs square baseline   | within 10%       | `finder-shapes`     |
| Combinatorial clean decode          | ≥ 3 of 4 engines | `combinations`      |
| High-risk combos vs square baseline | within 20%       | `combinations`      |
| Absolute robustness floor           | ≥ 40%            | `combinations`, e2e |
| Canvas PNG vs canonical SVG parity  | within 15%       | e2e                 |
| Center-overlay plate area           | ≤ 12% of symbol  | `overlay-budget`    |

## Characterized cross-engine behavior

Established, stable findings the suite encodes (e.g. the clean matrix requires a
3-of-4 quorum precisely because each engine has one blind spot):

| Engine                | Characterized behavior                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| jsQR                  | Mis-reads `dot` modules under `chamfer` finders                         |
| ZXing-JS / ZXing-wasm | Robust across every shipping combination                                |
| ZBar                  | Tougher on `circle` finders behind a center icon; weaker on dense codes |
| OpenCV (classic)      | Reads square finders only — rejects every shaped finder                 |
| WeChat                | Reads every combination except a few dense + heavily-shaped ones        |
| Apple Vision          | Reads every shipping combination — the most capable engine in the suite |

## Running the suite

```bash
npm run check            # format + lint + typecheck + unit/scannability tests
npm run test:e2e         # Playwright: real exports, clean + field-stress decode
npm run setup:decoders:py && npm run test:decoders:py   # OpenCV/WeChat layer
npm run report           # regenerate this document
```

Precise per-run robustness percentages (which vary slightly by platform) are
printed in the test logs and published to the GitHub Actions run summary.
