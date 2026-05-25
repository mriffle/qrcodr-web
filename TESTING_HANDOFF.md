# Testing Handoff

Onboarding doc for the qrcodr-web test suite. It explains **what exists, how
it's architected, how to run and extend it, and what's still open.** Read this
alongside:

- **`CLAUDE.md`** — the project-wide guide, including the v1/v2 rendering
  contract and the canonical test-strategy section. _That contract matters here:
  rendering goes through our own `qrToSvgString` (never `qrcode`'s built-in
  renderers), and **the SVG is the single source of truth** — the PNG export is
  that SVG rasterized via `<canvas>`._
- **`docs/TEST-REPORT.md`** — the **generated**, always-current inventory
  (counts, decoder panel, thresholds). Don't hand-edit it; see §8.

---

## 1. TL;DR

This project tests QR codes for **readability**, not just "the bytes round-trip
once." It generates codes with shaped modules/finders and center overlays
(icon, text, or both), then:

- decodes them with **seven independent engines** (4 in-process JS/wasm + 3
  native: OpenCV, WeChat, Apple Vision),
- after pushing the **real exported artifacts** through a **field-degradation
  battery** (blur, glare, rotation, true perspective, JPEG, noise, occlusion…),
- across **three browsers** for the canvas-based PNG export path — and the
  **real `<canvas>` PNG is fed to Apple Vision** on a macOS job (the actual iOS
  detector, not just a sharp-rasterized SVG),
- with **field-reliability thresholds enforced** as regression guards (including
  a center-overlay error-correction-budget bound),
- a **generated, freshness-guarded** Markdown report committed to the repo, and
- **CI that gates GitHub Pages deployment on every test job passing.**

Everything is client-side and offline; tests add no runtime dependencies to the
app.

---

## 2. Testing philosophy

A clean one-shot decode is a weak signal — `dot` modules decode fine clean but
fall apart in the field, and OpenCV's classic detector silently can't read any
shaped finder. So the suite is built around two ideas:

1. **Stress, then decode with many engines.** Different decoders use different
   finder-detection heuristics; a shape that fools one shouldn't slip through.
2. **Test the real artifacts.** Decode the actual downloaded PNG/SVG (and the
   real browser-canvas rasterization), not an idealized re-render — and feed
   them to the actual decoders real platforms use where possible.

---

## 3. Test layers

The unit + scannability layers run in `npm run test` (vitest); the gated native
layers self-skip without their toolchain; E2E is separate (Playwright).

| Layer                         | Location                                                             | Runner                    | What it guards                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unit & component              | `tests/unit/*.test.ts(x)`                                            | vitest (jsdom)            | Pure `src/lib` functions; `<PayloadInput>` behavior; overlay-budget geometry invariant                                   |
| Scannability · finders        | `tests/scannability/finder-shapes.test.ts`                           | vitest (node)             | Shaped finder/alignment patterns scan within margin of square, under stress, on all 4 in-process engines                 |
| Scannability · matrix         | `tests/scannability/combinations.test.ts`                            | vitest (node)             | Every module×finder×overlay (none/icon/text/both) combination (clean, quorum) + high-risk combos under the full battery  |
| Scannability · overlay budget | `tests/scannability/overlay-budget.test.ts`                          | vitest (node)             | The v1+overlay cliff stays fixed; floor-version overlay is field-safe; the area ceiling sits below the real decode cliff |
| Real-platform (gated)         | `tests/scannability/python-decoders.test.ts`, `apple-vision.test.ts` | vitest (node) + external  | OpenCV/WeChat/Apple-Vision read our codes (192-combo matrix incl. text/both overlays)                                    |
| End-to-end                    | `tests/e2e/generate-and-download.spec.ts`                            | Playwright (3 browsers)   | UI behavior; real PNG/SVG download → decode (clean + field-stress); cross-browser canvas parity                          |
| End-to-end · canvas×Vision    | `tests/e2e/canvas-vision.spec.ts`                                    | Playwright (macOS, gated) | The **real `<canvas>` PNG** export decodes on **Apple Vision** (chromium + Apple-WebKit); self-skips off-macOS           |

**Why scannability runs in the vitest `node` environment:** it uses `sharp`
(libvips) for rasterization/degradation and wasm decoders, which need Node, not
jsdom. Each scannability file declares `@vitest-environment node`.

---

## 4. The decoder panel (7 engines)

Defined in **`tests/scannability/decoders.ts`** (the 4 in-process engines, as the
async `DECODERS` array) plus two gated native layers. All take RGBA pixels and
return `{ ok, text }`.

| Engine                          | Kind            | Where                   | Notes                                                                 |
| ------------------------------- | --------------- | ----------------------- | --------------------------------------------------------------------- |
| jsQR                            | Pure JS         | in-process              | Reference web scanner                                                 |
| ZXing-JS                        | Pure JS         | in-process              | `@zxing/library`, TRY_HARDER                                          |
| ZXing-wasm                      | wasm (C++)      | in-process              | `zxing-wasm` — the zxing-cpp engine real native apps embed            |
| ZBar                            | wasm            | in-process              | `@undecaf/zbar-wasm` — different detector lineage                     |
| OpenCV `QRCodeDetector`         | native (C++)    | `.venv` (gated)         | `tools/decoders/decode_qr.py`                                         |
| WeChat `cv2.wechat_qrcode`      | native (CNN)    | `.venv` (gated)         | Same script; offline proxy for the dominant mobile scanner            |
| Apple Vision `VNDetectBarcodes` | native (Vision) | macOS + `swift` (gated) | `tools/apple-vision/decode_qr.swift` — the actual iOS Camera detector |

The native layers communicate via a temp-dir **manifest** (`{path, expect}[]`):
the test renders PNGs + writes the manifest, the external tool decodes the batch
and prints JSON, the test parses and asserts.

**Apple Vision runs in two places.** The gated vitest layer
(`apple-vision.test.ts`) feeds it the **sharp-rasterized** matrix; the macOS
`canvas-vision` Playwright job (`canvas-vision.spec.ts`) feeds it the **real
browser-`<canvas>`** PNG export. The second is the only place the actual
download pipeline (`svgToPng`) meets a real native decoder — the closest proxy
to "does an iPhone read the file the user downloaded" short of a device. There,
Playwright's `webkit` is Apple WebKit (CoreGraphics), a better Safari/iOS canvas
proxy than the Linux-WebKit used in the cross-browser E2E matrix.

---

## 5. The field-degradation battery

Defined in **`tests/scannability/stress.ts`** as `FAMILIES` (each transform takes
a master PNG buffer + intensity → decoder-ready RGBA). Ten families:

`shrink`, `blur`, `contrast`, `shear`, `rotate`, `jpeg`, `glare`, `noise`,
`occlusion`, `perspective`.

Two implementation notes a fresh agent must respect:

- **`noise` is seeded** (mulberry32) — Math.random would make the robustness
  guards flaky. Keep any new stochastic transform deterministic.
- **`perspective` is a true projective warp** (an 8-point homography solved in
  `stress.ts`), not the affine `shear`. It models real off-axis foreshortening.

`stress.ts` also exports **`STANDARD_BATTERY`** — one moderate-to-hard level per
family — the single battery shared by the combinatorial field guard
(`combinations.test.ts`) and the live CI metrics (`report-metrics.mts`), so the
published robustness numbers can't drift from what the suite enforces. (The
`finder-shapes`, `overlay-budget`, and E2E layers keep their own leaner,
purpose-specific batteries.)

---

## 6. Guards & thresholds (single source of truth)

**All enforced thresholds live in `tests/scannability/guards.ts` (`GUARDS`)** and
are imported by the tests _and_ the report generator, so the report can never
disagree with what the suite enforces.

| Guard                               | Constant             | Value            | Enforced in             |
| ----------------------------------- | -------------------- | ---------------- | ----------------------- |
| Shaped finders vs square baseline   | `finderShapeMargin`  | within 10%       | `finder-shapes`         |
| Combinatorial clean decode          | `cleanQuorum`        | ≥ 3 of 4 engines | `combinations`          |
| High-risk combos vs square baseline | `combosMargin`       | within 20%       | `combinations`          |
| Absolute robustness floor           | `robustnessFloor`    | ≥ 40%            | `combinations`, e2e     |
| Canvas PNG vs canonical SVG parity  | `pngSvgParityMargin` | within 15%       | e2e                     |
| Center-overlay plate area           | `overlayAreaCeiling` | ≤ 12% of symbol  | `overlay-budget` (unit) |

**Why a quorum, not unanimity:** each engine has one documented blind spot on
extreme shape stacks (see §11), but never the _same_ combo — so 3-of-4 proves a
combination is broadly scannable while still failing a combo that breaks two+
engines.

**Center-overlay budget + the `MIN_OVERLAY_VERSION` policy (read before touching
overlays).** A center icon/text paints an _opaque backing plate_ over the
central modules — that plate's area is a direct draw on the error-correction
budget, and the plate size depends only on `hasIcon` + text length, never the
glyph (so `heart` is representative; we don't multiply the matrix across icons).
At **version 1** the codeword count is so small that, for some payload/mask
combinations, the occluded codewords are unrecoverable even at level H — e.g.
`"hello"` + an icon decoded on **zero** of four engines, while the same payload
with no overlay read fine. Fix: **`generateQr(payload, { minVersion })`** floors
the version, and `src/App.tsx` passes **`MIN_OVERLAY_VERSION` (= 3)** whenever
`styleHasOverlay(style)` (giving EC headroom + finder clearance for any
content). Two guards lock this in: the **unit** half
(`tests/unit/overlay-budget.test.ts`) is a pure geometric invariant (plate area
≤ `overlayAreaCeiling`, plate clear of the finders, swept over every renderable
version) and would fail if someone enlarges the icon/pad constants or drops the
min version back toward v1; the **scannability** half
(`tests/scannability/overlay-budget.test.ts`) proves the cliff is real, the
policy fixes it, the floor version is field-safe, and the area ceiling sits
below the measured ~25–30% decode cliff.

**If you change a threshold or add/remove tests, you must run `npm run report`
and commit the regenerated `docs/TEST-REPORT.md`** (CI fails otherwise — §8).

---

## 7. Enabling the gated native layers

Both self-skip cleanly when their toolchain is absent, so `npm run test` is
green everywhere; they only _run_ where the tooling exists.

**OpenCV + WeChat (Python):**

```bash
npm run setup:decoders:py     # one-time: creates .venv, installs opencv-contrib-python
npm run test:decoders:py      # run just this layer
```

⚠️ **Python rule:** always use the project-local `.venv` (gitignored). **Never
install Python packages on the host interpreter.** The setup script and
`tools/decoders/requirements.txt` enforce this.

**Apple Vision (macOS + Swift):**

```bash
npm run test:vision:apple     # requires macOS + a `swift` toolchain (ships with Xcode)
```

No install step — it compiles `tools/apple-vision/decode_qr.swift` on the fly.

---

## 8. The test report system

`docs/TEST-REPORT.md` is **generated** by `scripts/generate-test-report.mts` and
**README-linked** so it's visible on GitHub. Key design decisions:

- **Deterministic content only.** It contains test inventory (counts from
  `vitest list` / `playwright --list`, which enumerate without executing), the
  `GUARDS` thresholds, the decoder panel, the degradation battery, and stable
  qualitative findings. It deliberately **omits measured percentages and
  timestamps**, because those drift macOS↔Linux and would defeat the freshness
  check.
- **Freshness-guarded, not auto-committed.** CI regenerates it and runs
  `git diff --exit-code` (`npm run report:check`). No bot commits; report changes
  show up in PRs.
- **Live numbers go to the CI job summary**, not the repo, via
  `scripts/report-metrics.mts` (`npm run report:metrics`) — these are the
  per-run, platform-specific robustness percentages.

```bash
npm run report          # regenerate docs/TEST-REPORT.md (+ prettier)
npm run report:check    # regenerate and fail if it drifted (CI uses this)
npm run report:metrics  # print this run's live robustness numbers
```

> ⚠️ `report:check` only bites once `docs/TEST-REPORT.md` is **committed** —
> `git diff` ignores untracked files.

---

## 9. CI / deployment architecture

One consolidated workflow: **`.github/workflows/ci.yml`** (the old separate
`deploy.yml`/`test.yml` were merged — don't reintroduce a standalone deploy
workflow; cross-workflow gating can't express the `needs:` dependency).

```
        ┌─ check         (format, lint, typecheck, unit+scannability, report:check) ┐
        ├─ e2e           (matrix: chromium / firefox / webkit)                       │
        ├─ decoders      (OpenCV + WeChat, ubuntu + .venv)                           │
push/PR ┼─ apple-vision  (Apple Vision on sharp PNGs, macos-latest)                  ├─► deploy
        ├─ canvas-vision (real <canvas> PNG → Apple Vision, macos-latest)            │   needs: ALL
        └─ build         (vite build → Pages artifact)                              ┘   main only
```

- **Deploy is gated:** the `deploy` job
  `needs: [check, e2e, decoders, apple-vision, canvas-vision, build]` and only
  runs on `main` (push/dispatch), never PRs. A failing test job (or any browser
  matrix leg) blocks the deploy. **Note: two of the gating legs are
  `macos-latest`** (`apple-vision`, `canvas-vision`), which can queue longer —
  see §12.
- **`canvas-vision`** installs Playwright chromium + webkit on macOS and runs
  only `canvas-vision.spec.ts` (`npm run test:e2e:canvas-vision`). The spec is
  also picked up (and self-skipped, no Swift) by the Linux `e2e` matrix legs via
  the `grep: /PNG/` filter, so `playwright --list` counts it under all three
  browser projects even though it executes only on the macOS job.
- **Parallelism:** five jobs fan out; within them vitest multi-threads and
  Playwright uses `workers: '50%'` on CI.
- **Cross-browser:** Chromium runs the full E2E suite; Firefox/WebKit run only
  the canvas-path subset via `grep: /PNG/` in `playwright.config.ts` (that's the
  only browser-dependent path — `svgToPng`'s SVG→canvas rasterization).
- **PRs** run everything (so `build` validates the production compile) but skip
  deploy; Pages-artifact steps are guarded so fork PRs without `pages: write`
  don't fail.

---

## 10. Command reference

```bash
npm run check              # format:check + lint + typecheck + test (the gate)
npm run test               # vitest: unit + component + scannability
npm run test:e2e           # Playwright (builds + previews; all 3 browser projects)
npm run test:e2e:canvas-vision  # real canvas PNG → Apple Vision (macOS; chromium + webkit)
npm run setup:decoders:py  # one-time Python venv for OpenCV/WeChat
npm run test:decoders:py   # OpenCV/WeChat layer only
npm run test:vision:apple  # Apple Vision layer only (macOS; sharp-rasterized matrix)
npm run report             # regenerate docs/TEST-REPORT.md
npm run report:check       # freshness guard
npm run report:metrics     # live robustness numbers (CI summary)

# single test file:  npx vitest run tests/scannability/combinations.test.ts
# single e2e by name: npx playwright test -g "field battery"
# one browser:        npx playwright test --project=webkit
```

---

## 11. Key cross-engine findings (stable)

Established and encoded into the suite's policy (illustrative numbers from recent
runs; exact figures vary slightly by platform):

The combinatorial matrix is now **192 combos** (6 modules × 4 finders × 4
overlay states `none/icon/text/both` × 2 payloads):

| Engine           | Characterized behavior                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| jsQR             | Mis-reads `dot` modules under `chamfer` finders                         |
| ZXing-JS / -wasm | Robust across every shipping combination                                |
| ZBar             | Tougher on `circle` finders behind a center icon; weaker on dense codes |
| OpenCV (classic) | **Reads square finders only** — rejects every shaped finder (~50/192)   |
| WeChat           | Reads ~187/192; only a few dense + heavily-shaped combos slip           |
| Apple Vision     | **Reads 192/192** — the most capable engine in the suite                |

Field robustness (decode rate over the battery × engines): square baseline ≈
67%; worst shipping combo (rounded+circle+icon, and rounded+circle+icon+text) ≈
54%; center-text alone costs ~nothing over the icon. Canvas-PNG vs SVG parity
holds across browsers (e.g. Chromium 68/68%, Firefox/WebKit differ by a few
points — proof the rasterizers genuinely differ).

**v1 + overlay was a real bug, now fixed.** Before the `MIN_OVERLAY_VERSION`
policy (§6), a center overlay on a content-unlucky version-1 code (e.g.
`"hello"` + icon) was unscannable on _every_ engine — the matrix never caught it
because its payloads all land at v4+. Flooring overlay codes to v3 resolved it;
`overlay-budget` guards against regression.

---

## 12. Outstanding issues & deferred work

**Recently resolved (this round — on branch `more-testing`, pushed):**

- ✅ **Center text was invisible to the multi-engine/native/field layers.** Added
  the `none/icon/text/both` overlay axis to `matrix.ts`, so text + the icon+text
  stack are now exercised across the clean quorum, the field battery, and all
  three native engines (matrix grew 96 → 192 combos).
- ✅ **Real canvas PNG × native decoder** (was the highest-value gap) — closed by
  the macOS `canvas-vision` job: the genuine `<canvas>` export is decoded by
  Apple Vision. See §3/§4/§9.
- ✅ **Overlay error-correction budget is now property-tested** — and doing so
  surfaced + fixed a real bug: v1 + overlay could be unscannable (§6, §11). Two
  new guards (`overlay-budget`, unit + scannability) + the `MIN_OVERLAY_VERSION`
  policy.
- ✅ **Field battery deduped** — one `STANDARD_BATTERY` shared by the guard and
  the live metrics (§5).
- ✅ **Single representative icon justified** — documented why the overlay plate
  is glyph-independent, so `heart` alone suffices (§6).

**Open gaps (surfaced, not yet addressed):**

1. **Real _Safari_ canvas still isn't in CI.** The `canvas-vision` job uses
   Playwright's macOS `webkit` (Apple WebKit / CoreGraphics) — much closer than
   the Linux-WebKit proxy, but still not real `safaridriver`/Safari (that option
   was declined). Vision-on-real-Safari-canvas remains inferred.
2. **No in-app guidance for the OpenCV-classic limitation** — shaped finders are
   unreadable by bare `cv2.QRCodeDetector`. Characterized/accepted; a user
   picking a circle finder gets no warning. Possible UX item, not a test item.

**Risks / open decisions:**

3. **Two `macos-latest` legs now gate deploy** (`apple-vision` + `canvas-vision`)
   alongside the WebKit-on-Linux `e2e` leg (flakiest target, mitigated by
   `retries: 2`). macOS runners can queue longer, so deploy latency/availability
   risk went up. One-line levers if they churn: drop a leg from `deploy.needs`
   (report but don't block). _Worth a deliberate decision before an urgent
   deploy hits the queue._
4. **Branch-protection required checks** aren't set — recommended to require the
   CI jobs for PR merges (complements the deploy gate). Repo setting; can't be
   done from code.

**Deferred by choice:**

5. **Android ML Kit** via emulator (real Google decoder) — highest-effort native
   layer; not started.
6. **Tier-3 physical-device capture rig** — out of CI scope (manual/periodic).

---

## 13. Conventions for extending (read before changing tests)

- **Before shipping a new structural shape** (module/finder/etc.), add its decode
  to the scannability suite first — a clean-only test passes shapes that regress
  badly in the field.
- **Changing a guard threshold or adding/removing tests** → update only
  `tests/scannability/guards.ts` if it's a threshold, then `npm run report` and
  commit `docs/TEST-REPORT.md`.
- **New degradation transforms** must be deterministic (seed any randomness). If
  it's a general-purpose level, consider adding it to `STANDARD_BATTERY` (§5) so
  the guard and the live metrics move together.
- **Changing center overlays** (bigger icon, new overlay kind, different sizing):
  re-check the overlay-budget guards (§6) — the geometric invariant caps the
  plate area / finder clearance, and overlays must still floor to
  `MIN_OVERLAY_VERSION`. The plate is glyph-independent, so add the new _kind_ to
  the `OVERLAYS` axis in `matrix.ts`, not a new icon.
- **New decoders**: add in-process JS/wasm engines to `DECODERS` (async
  signature); native engines follow the manifest pattern + a gated test that
  self-skips without its toolchain.
- **Python** lives in `.venv` only — never the host (§7).
- **The file-based decoder layers** (Python, Vision) share the matrix renderer in
  `tests/scannability/matrix.ts` — reuse it rather than re-rolling the grid.
- **Don't put measured percentages or timestamps in the generated report** — it
  must stay byte-deterministic across machines (§8).

---

## 14. File map

```
tests/
  unit/                              # pure-function + component tests (jsdom)
    overlay-budget.test.ts           # overlay-plate geometric invariant (area ≤ ceiling, finder clearance)
  scannability/
    guards.ts                        # GUARDS thresholds (single source) + pct()
    decoders.ts                      # the 4 in-process engines (async DECODERS)
    stress.ts                        # FAMILIES battery + shared STANDARD_BATTERY (seeded noise, homography)
    matrix.ts                        # shared module×finder×overlay(none/icon/text/both)×payload renderer
    finder-shapes.test.ts            # shaped-finder field guard
    combinations.test.ts             # combinatorial clean + field-battery guard
    overlay-budget.test.ts           # overlay decode cliff: v1 bug fixed, floor-version field-safe, ceiling < cliff
    python-decoders.test.ts          # OpenCV + WeChat (gated on .venv)
    apple-vision.test.ts             # Apple Vision on sharp PNGs (gated on macOS + swift)
  e2e/
    generate-and-download.spec.ts    # UI + real PNG/SVG decode + field-stress + cross-browser
    canvas-vision.spec.ts            # real <canvas> PNG → Apple Vision (gated macOS; chromium + webkit)

tools/
  decoders/decode_qr.py              # OpenCV + WeChat batch decoder
  decoders/requirements.txt          # opencv-contrib-python, numpy (into .venv only)
  apple-vision/decode_qr.swift       # VNDetectBarcodesRequest batch decoder

scripts/
  setup-python-decoders.sh           # build .venv + install
  generate-test-report.mts           # writes docs/TEST-REPORT.md (deterministic)
  report-metrics.mts                 # live robustness numbers for the CI summary

.github/workflows/ci.yml             # consolidated CI: parallel test jobs → gated deploy
playwright.config.ts                 # chromium full + firefox/webkit (grep /PNG/), 50% workers on CI
docs/TEST-REPORT.md                  # GENERATED — do not hand-edit
```
