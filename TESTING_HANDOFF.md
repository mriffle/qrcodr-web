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
once." It generates codes with shaped modules/finders and center overlays, then:

- decodes them with **seven independent engines** (4 in-process JS/wasm + 3
  native: OpenCV, WeChat, Apple Vision),
- after pushing the **real exported artifacts** through a **field-degradation
  battery** (blur, glare, rotation, true perspective, JPEG, noise, occlusion…),
- across **three browsers** for the canvas-based PNG export path,
- with **field-reliability thresholds enforced** as regression guards,
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

Five layers. The first three run in `npm run test` (vitest); the gated native
layers self-skip without their toolchain; E2E is separate (Playwright).

| Layer                  | Location                                                             | Runner                   | What it guards                                                                                           |
| ---------------------- | -------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Unit & component       | `tests/unit/*.test.ts(x)`                                            | vitest (jsdom)           | Pure `src/lib` functions; `<PayloadInput>` behavior                                                      |
| Scannability · finders | `tests/scannability/finder-shapes.test.ts`                           | vitest (node)            | Shaped finder/alignment patterns scan within margin of square, under stress, on all 4 in-process engines |
| Scannability · matrix  | `tests/scannability/combinations.test.ts`                            | vitest (node)            | Every module×finder×overlay combination (clean, quorum) + high-risk combos under the full battery        |
| Real-platform (gated)  | `tests/scannability/python-decoders.test.ts`, `apple-vision.test.ts` | vitest (node) + external | OpenCV/WeChat/Apple-Vision read our codes                                                                |
| End-to-end             | `tests/e2e/generate-and-download.spec.ts`                            | Playwright (3 browsers)  | UI behavior; real PNG/SVG download → decode (clean + field-stress); cross-browser canvas parity          |

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

---

## 6. Guards & thresholds (single source of truth)

**All enforced thresholds live in `tests/scannability/guards.ts` (`GUARDS`)** and
are imported by the tests _and_ the report generator, so the report can never
disagree with what the suite enforces.

| Guard                               | Constant             | Value            | Enforced in         |
| ----------------------------------- | -------------------- | ---------------- | ------------------- |
| Shaped finders vs square baseline   | `finderShapeMargin`  | within 10%       | `finder-shapes`     |
| Combinatorial clean decode          | `cleanQuorum`        | ≥ 3 of 4 engines | `combinations`      |
| High-risk combos vs square baseline | `combosMargin`       | within 20%       | `combinations`      |
| Absolute robustness floor           | `robustnessFloor`    | ≥ 40%            | `combinations`, e2e |
| Canvas PNG vs canonical SVG parity  | `pngSvgParityMargin` | within 15%       | e2e                 |

**Why a quorum, not unanimity:** each engine has one documented blind spot on
extreme shape stacks (see §11), but never the _same_ combo — so 3-of-4 proves a
combination is broadly scannable while still failing a combo that breaks two+
engines.

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
        ┌─ check        (format, lint, typecheck, unit+scannability, report:check)  ┐
        ├─ e2e          (matrix: chromium / firefox / webkit)                       │
push/PR ┼─ decoders     (OpenCV + WeChat, ubuntu + .venv)                           ├─► deploy
        ├─ apple-vision (Apple Vision, macos-latest)                                │   needs: ALL
        └─ build        (vite build → Pages artifact)                               ┘   main only
```

- **Deploy is gated:** the `deploy` job `needs: [check, e2e, decoders, apple-vision, build]`
  and only runs on `main` (push/dispatch), never PRs. A failing test job (or any
  browser matrix leg) blocks the deploy.
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
npm run setup:decoders:py  # one-time Python venv for OpenCV/WeChat
npm run test:decoders:py   # OpenCV/WeChat layer only
npm run test:vision:apple  # Apple Vision layer only (macOS)
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

| Engine           | Characterized behavior                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| jsQR             | Mis-reads `dot` modules under `chamfer` finders                         |
| ZXing-JS / -wasm | Robust across every shipping combination                                |
| ZBar             | Tougher on `circle` finders behind a center icon; weaker on dense codes |
| OpenCV (classic) | **Reads square finders only** — rejects every shaped finder (~26/96)    |
| WeChat           | Reads ~93/96; only a few dense + heavily-shaped combos slip             |
| Apple Vision     | **Reads 96/96** — the most capable engine in the suite                  |

Field robustness (decode rate over the battery × engines): square baseline ≈
65%; worst shipping combo (rounded+circle+icon) ≈ 50–54%. Canvas-PNG vs SVG
parity holds across browsers (e.g. Chromium 68/68%, Firefox/WebKit differ by a
few points — proof the rasterizers genuinely differ).

---

## 12. Outstanding issues & deferred work

**Open gaps (surfaced, not yet addressed):**

1. **Real canvas PNG × native decoder is untested.** The native decoders
   (Vision/OpenCV/WeChat) decode **sharp-rasterized** PNGs (`matrix.ts`), while
   the real **browser-canvas** PNG is only decoded by the 4 JS engines (E2E).
   So "does an iPhone read the actual _downloaded_ PNG?" is inferred, not
   measured. Closing it needs a combined macOS job: Playwright produces the
   canvas PNG → Apple Vision decodes it. _(Highest-value remaining item.)_
2. **Real Safari canvas isn't in CI** — only Playwright's Linux-WebKit proxy
   (the `safaridriver`-on-macOS option was declined).
3. **No in-app guidance for the OpenCV-classic limitation** — shaped finders are
   unreadable by bare `cv2.QRCodeDetector`. Characterized/accepted; a user
   picking a circle finder gets no warning. Possible UX item, not a test item.
4. **Center-icon error-correction budget boundary isn't property-tested** — we
   only test the app's fixed icon size, not the worst-case size limit.

**Risks / open decisions:**

5. **WebKit-on-Linux is the flakiest target and gates deploy** — mitigated by
   `retries: 2`; if it churns, the lever is to make that leg non-blocking.
6. **The macOS Apple Vision job gates deploy** — macOS runners can queue longer.
   One-line lever: drop `apple-vision` from `deploy.needs` to make it
   non-blocking while still reporting.

**Deferred by choice:**

7. **Android ML Kit** via emulator (real Google decoder) — highest-effort native
   layer; not started.
8. **Tier-3 physical-device capture rig** — out of CI scope (manual/periodic).

**Immediate action items (as of this handoff):**

9. **None of the testing work is committed yet** (baseline commit `3bdcbb4`).
   Until committed and pushed: `report:check` is inert (untracked file) and the
   CI workflow won't run. _Commit + push `ci.yml`, `docs/TEST-REPORT.md`, and the
   rest first._
10. **Branch-protection required checks** aren't set — recommended to require the
    CI jobs for PR merges (complements the deploy gate). Repo setting; can't be
    done from code.

---

## 13. Conventions for extending (read before changing tests)

- **Before shipping a new structural shape** (module/finder/etc.), add its decode
  to the scannability suite first — a clean-only test passes shapes that regress
  badly in the field.
- **Changing a guard threshold or adding/removing tests** → update only
  `tests/scannability/guards.ts` if it's a threshold, then `npm run report` and
  commit `docs/TEST-REPORT.md`.
- **New degradation transforms** must be deterministic (seed any randomness).
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
  scannability/
    guards.ts                        # GUARDS thresholds (single source) + pct()
    decoders.ts                      # the 4 in-process engines (async DECODERS)
    stress.ts                        # FAMILIES degradation battery (seeded noise, homography)
    matrix.ts                        # shared module×finder×overlay×payload renderer
    finder-shapes.test.ts            # shaped-finder field guard
    combinations.test.ts             # combinatorial clean + field-battery guard
    python-decoders.test.ts          # OpenCV + WeChat (gated on .venv)
    apple-vision.test.ts             # Apple Vision (gated on macOS + swift)
  e2e/
    generate-and-download.spec.ts    # UI + real PNG/SVG decode + field-stress + cross-browser

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
