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
2. **`QrStyle` carries v2 fields with v1 defaults.** `moduleShape`, `canvasShape`, and `centerIcon` are declared in `src/lib/qr.ts` but only `square`/no-icon is implemented. The rendering pipeline already accepts them; v2 swaps the implementation, not the type.
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

### Project direction: "Apparatus"

Engineering blueprint / drafting document. Cobalt blueprint background (`--cobalt` `#0F1B3D`), chalk drafting-paper QR card (`--chalk` `#F0EDE2`), signal-yellow accents (`--signal` `#FFD60A`). Type pairing: **IBM Plex Serif** (title block, display) + **Space Mono** (body, mono), self-hosted via `@fontsource/*`. Tokens in `src/styles/tokens.css`, layout in `src/styles/apparatus.css`.

Do not drift toward generic dashboard / dev-tool styling. If a new element doesn't have an Apparatus interpretation, design one (errors as redline annotations, loading as ink filling in, version stamps in title-block cells, etc.).

### Durable design rules (apply to any new UI work)

These hold regardless of feature. Violations should feel obviously wrong against this codebase.

- **No generic AI defaults.** Banned fonts: **Inter, Roboto, Arial, system fonts, Space Grotesk**. Banned palettes: **purple gradients on white**, evenly-distributed timid color schemes.
- **Type pairing matters.** Use a distinctive display font + a refined body/mono font. The current pairing is IBM Plex Serif + Space Mono — keep it cohesive; don't add a third typeface without a real reason.
- **Color discipline.** Dominant colors with sharp accents, not even distribution. The Apparatus accent is the signal-yellow `--signal` — use it sparingly for emphasis (caret, glyphs, hover state). New colors go through `tokens.css` as CSS custom properties, never inline hex.
- **Layout.** Prefer asymmetry, controlled density, and grid-breaking over predictable component grids. The title block + dimension lines are the existing examples.
- **Backgrounds.** Atmosphere, not flat fills. The body uses a grid-paper repeating-gradient over cobalt; new background regions should add texture, layered transparency, or a hairline border rather than a solid block.
- **Motion.** Prefer CSS-only motion (already in use via the staggered `.apparatus > *` reveal). For richer interaction-driven animation, use the **Motion** library (`motion` is already a dependency) — don't reach for Framer Motion (deprecated import path) or hand-rolled `requestAnimationFrame`. Respect `prefers-reduced-motion`.
- **Implementation matches intent.** Apparatus is a _precision_ aesthetic, not a maximalist one — every line, padding value, and label deserves intentionality. Loose spacing or default browser styling reads as a regression here.

## Relationship to the Python app

`/home/mriffle/vscode/qrcodr` is the Python reference implementation. Match its defaults where reasonable — error correction `H`, quiet zone 4, byte mode, auto version-fit. **Intentional divergences from Python parity in v1:**

- No PDF export (Python has it via `reportlab`).
- No "Save All" button — each format is its own click.

Don't add features the Python version doesn't have (e.g. color customization, logo embedding) without checking — v2 will add them deliberately, not opportunistically.
