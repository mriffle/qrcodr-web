# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser SPA reimplementation of the Python desktop app **qrcodr** (at `/home/mriffle/vscode/qrcodr`). Fully client-side: no backend, no network calls, no upload. v1 exports PNG + SVG; v2 will add color pickers, shaped modules, canvas shape options, and a center-icon overlay.

## Commands

```bash
npm run dev            # Vite dev server on :5173 (HMR)
npm run build          # tsc -b && vite build
npm run preview        # serve the build (used by Playwright)

npm run typecheck      # tsc -b --noEmit
npm run lint           # eslint .
npm run format         # prettier --write .
npm run format:check   # prettier --check .

npm run test           # vitest run (unit + component, jsdom)
npm run test:watch     # vitest in watch mode
npm run test:e2e       # playwright test (builds + previews automatically)
npm run test:e2e:ui    # playwright in UI mode

npm run check          # format:check + lint + typecheck + test (all in one)
```

Run a single unit test file: `npx vitest run tests/unit/qr.test.ts`
Run a single E2E test: `npx playwright test -g "decodes back to its payload"`

The Playwright config (`playwright.config.ts`) starts its own preview server on port 4173; do **not** point it at the dev server (Vite dev injects React Refresh and HMR script tags that can interfere with tests).

## Architecture

### The v1/v2 contract (read before changing core)

This is a v1 release deliberately scoped narrow, with hooks for v2 already in place. Honor these or v2 becomes a rewrite:

1. **Never use `qrcode`'s built-in renderers** (`toDataURL`, `toString`, etc.). We use `QRCode.create()` to get the raw matrix only. All rendering is our own, so v2 can add custom module shapes / colors / center icons by editing one function.
2. **`QrStyle` carries v2 fields with v1 defaults.** `moduleShape` (`square`/`rounded`/`chamfer`/`dot`/`horizontal-pill`/`vertical-pill`) and `centerIcon` are implemented; `canvasShape` is still a declared-but-unimplemented v2 hook (`'square'` only). The rendering pipeline already accepts it; v2 swaps the implementation, not the type. `chamfer` shares `rounded`'s per-corner merge logic (`shouldRoundCorner`) but emits straight 45° cuts (`CHAMFER_DEPTH`) instead of arcs. Pill modes fuse adjacent on-cells along one axis into capsules with a small cross-axis gap (`PILL_GAP`); reserved cells (finder/timing/alignment) stay square for every non-`square` shape.
3. **SVG is the single source of truth.** `qrToSvgString()` produces the canonical artifact. The SVG download writes it verbatim; the PNG download rasterizes it via `<canvas>` (`svgToPng` in `src/lib/download.ts`). Both export formats render identically by construction.
4. **The Apparatus chrome is in the React component, NOT the exported SVG.** `src/components/QrDrawing.tsx` adds dimension lines, registration marks, and version stamps for the on-screen preview. The downloaded files contain only the bare scannable QR — those decorations would break scanners.

### Validation: branded type

`src/lib/payload.ts` exports `ValidatedPayload`, a branded string. `generateQr(payload: ValidatedPayload)` cannot be called with a raw string — only `validatePayload()` can mint values. This catches "I forgot to validate" bugs at compile time. When adding new entry points, route them through `validatePayload`.

### Data flow

```
user input
  → validatePayload()                       (src/lib/payload.ts)
  → ValidatedPayload (branded)
  → generateQr()                            (src/lib/qr.ts)
  → QrResult { matrix, size, version, … }
  ├→ <QrDrawing qr style />                 on-screen w/ apparatus chrome
  └→ qrToSvgString(qr, style)               canonical artifact
       ├→ Blob → download                   .svg
       └→ svgToPng() via <canvas>           .png
```

All state lives in `App.tsx` as `useState` + `useMemo`. There's no router, no global store, no async data fetching — keep it that way unless adding a feature that genuinely needs it.

### Test strategy (three layers)

- **Unit** (`tests/unit/*.test.ts`) — pure functions in `src/lib/*`. Validation rules, matrix invariants (size² length, finder-pattern corners, version monotonicity), SVG structural properties, filename slugging.
- **Component** (`tests/unit/*.test.tsx`) — React Testing Library + jsdom. Behavior of `<PayloadInput>` (event wiring, error states). Use `getByRole('textbox')` for the input — `getByLabelText(/payload/i)` matches both the section's aria-label and the input's, and will fail.
- **E2E + QR decode** (`tests/e2e/*.spec.ts`) — Playwright drives the real built app. The decode tests are the load-bearing safety net: each downloads a PNG/SVG, rasterizes via `sharp` (for SVG), and decodes via `jsqr`, asserting the decoded text equals the input. This catches subtle SVG layout regressions that a snapshot test would miss (e.g. a quiet-zone bug that scanners reject but humans can't see).

When changing anything in `src/lib/qr.ts` or `src/lib/download.ts`, the E2E decode suite is what tells you whether real scanners will still read it.

## TypeScript posture

Senior-level type rigor, scaled to a single-page app. Apply these defaults; resist library-grade ceremony.

### Compiler

Strict-everything: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. Two implications worth knowing:

- `exactOptionalPropertyTypes` means you can't pass `undefined` to an optional prop — spread it conditionally (`...(condition ? { workers: 1 } : {})`). See `playwright.config.ts` for the pattern.
- `verbatimModuleSyntax` requires `import type` for compile-time-only references.

ESLint runs `@typescript-eslint/recommendedTypeChecked`, so `no-misused-promises` and `no-floating-promises` are caught at lint time.

### Patterns to use

- **No `any` without an inline justification comment.** If you genuinely need an escape hatch, write a one-line `// any: <reason>` above it.
- **Discriminated unions for state machines** (loading/ready/error, idle/generating, etc.) and result-like shapes. `ValidationResult` in `src/lib/payload.ts` is the canonical example — `{ ok: true; value }` vs `{ ok: false; error }`. Narrow with `if (result.ok)` rather than throwing.
- **Branded types** for validated domain values whose invariants must survive function boundaries. `ValidatedPayload` is the pattern — the brand prevents callers from sneaking in unvalidated strings. Add a new brand when you have a string/number with rules a static type alias can't enforce.
- **`satisfies`** for config objects that need _both_ type-checking and preserved literal types (so downstream code sees `'png'` rather than widened `string`).
- **`as const`** for tuples and literal unions extracted from values (e.g. the E2E `TEST_PAYLOADS` fixture).
- **Type-only imports** (`import type` / inline `import { type X }`) for compile-time-only references. Required by `verbatimModuleSyntax`.
- **Exhaustive checks**: in a `switch` on a union, ensure each arm returns or use a `never`-typed default to fail fast when the union grows.
- **Type predicates / guards** at boundaries where structural narrowing isn't enough.

### Patterns to skip on this project

These are valid TS techniques in other contexts but overkill here. Don't introduce without a real need:

- tRPC / GraphQL codegen / OpenAPI clients (no backend)
- Project references / monorepo workspaces (single package)
- Higher-kinded type simulation or deep type-level programming
- Heavy form-validation type machinery (Zod for a one-field form)
- Library-authoring concerns (declaration bundling, type versioning)

## Aesthetic direction

### Project direction: "HUD" (cyberpunk operative)

A near-future operative terminal — dense, charged, intentionally cyberpunk. Replaced the original "Apparatus" engineering-blueprint direction on 2026-05-20.

**Palette** (tokens in `src/styles/tokens.css`):

- `--onyx-void` `#04060A` / `--onyx-deep` `#07090F` / `--onyx` `#0B0F17` / `--onyx-rise` `#11161F` / `--onyx-edge` `#1C2230` — the dark surfaces
- `--bone` `#E9EFE2` — primary readable text (NOT pure white — slightly warm)
- `--lime` `#B6FF1F` — acid lime, the primary signal accent (caret, sigil, PNG export, lock state)
- `--coral` `#FF4F5E` — hot coral, danger/error/SVG export

The page background is a layered radial gradient (faint lime wash top-left + coral spark top-right + vertical falloff into pure void) with two atmospheric overlays: CRT scanlines (`body::before`) and a vignette (`body::after`).

**Type pairing**:

- **Orbitron** (display) — masthead sigil, button caps, labels. `@fontsource/orbitron`
- **JetBrains Mono** (body, mono) — payload prompt, telemetry values, everything else. `@fontsource/jetbrains-mono`

**Layout** in `src/styles/hud.css`:

- `.masthead` — full-width system banner with brand sigil + live UTC-style timestamp + Node/Channel/Live status
- `.console` — left-rail input + telemetry
- `.stage` — viewport with HUD corner brackets + reticle crosshair + soft lime bloom around the QR
- `.drawer` — bottom export bar with parallelogram-clipped action chips
- Collapses to single column under 920px

**Memorable hook**: the QR sits inside a viewport with HUD corner brackets and a reticle, lime bloom radiating from a white module square. The masthead has a live ticking timestamp + pulsing "Live" dot. Payload input reads as a terminal prompt (`./forge >`) with a blinking lime caret.

Do not drift toward generic dashboard / dev-tool styling. If a new element doesn't have a HUD interpretation, design one (loading as a lock-acquire sweep, errors as a coral system alert, success as a lime confirm chime, etc.).

### Durable design rules (apply to any new UI work)

These hold regardless of feature. Violations should feel obviously wrong against this codebase.

- **No generic AI defaults.** Banned fonts: **Inter, Roboto, Arial, system fonts, Space Grotesk**. Banned palettes: **purple gradients on white**, evenly-distributed timid color schemes.
- **Type pairing matters.** A strong display font + a crisp mono body. The current pairing is Orbitron + JetBrains Mono — keep it cohesive; don't add a third typeface without a real reason.
- **Color discipline.** Dominant onyx with sharp lime + coral accents. The lime is the primary "system live / OK" signal — use it sparingly for emphasis (caret, sigil, lock state). Coral is for danger/error and the SVG action only. New colors go through `tokens.css` as CSS custom properties, never inline hex.
- **Layout.** Asymmetry and controlled density. The masthead + console + stage + drawer composition is the existing example. Avoid centered single-column dashboard layouts.
- **Backgrounds.** Atmosphere, not flat fills. The body uses layered radial gradients + scanlines + vignette. New raised panels should use `--onyx-rise` with a `--onyx-edge` hairline, not a different solid color.
- **Motion.** Prefer CSS for ambient effects (scanlines, caret blink, pulse dot). For richer interaction-driven animation, use the **Motion** library (`motion` is already a dependency) — don't reach for Framer Motion (deprecated import path) or hand-rolled `requestAnimationFrame`. Always respect `prefers-reduced-motion` — disable scanlines/glitch/pulse for users who opt out (see existing `@media (prefers-reduced-motion: reduce)` blocks in `hud.css`).
- **Accessibility under cyberpunk.** Neon doesn't excuse poor contrast or invisible focus rings. Verify WCAG AA on text colors (lime on onyx-void passes; lime on onyx-rise needs eyeballing). Focus rings use a visible lime outline.
- **Implementation matches intent.** This is a committed-cyberpunk aesthetic, not "vaguely techy." Every element should feel deliberately operative — terminal labels (`./forge >`, `Eject :: Artifact`), telemetry-style metadata, sigils not bullet points.

## Relationship to the Python app

`/home/mriffle/vscode/qrcodr` is the Python reference implementation. Match its defaults where reasonable — error correction `H`, quiet zone 4, byte mode, auto version-fit. **Intentional divergences from Python parity in v1:**

- No PDF export (Python has it via `reportlab`).
- No "Save All" button — each format is its own click.

Don't add features the Python version doesn't have (e.g. color customization, logo embedding) without checking — v2 will add them deliberately, not opportunistically.
