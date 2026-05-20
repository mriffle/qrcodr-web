# qrcodr-web

A browser-based QR code generator with a cyberpunk operative-terminal aesthetic. Fully client-side — no backend, no uploads, no tracking. Your payload never leaves the browser.

## 🚀 Try it now

**→ [https://mriffle.github.io/qrcodr-web/](https://mriffle.github.io/qrcodr-web/)**

Works on **desktop and mobile** — the HUD collapses to a single-column layout on narrow viewports, and all controls (color pickers, icon picker, exports) are touch-friendly.

## Example

A QR code generated with qrcodr-web — gold-on-purple, rounded modules, rocket center icon, and a `TRY IT!` label:

![Example QR code generated with qrcodr-web](assets/example-qrcode.png)

Scan it with any phone camera — it decodes to the live app.

## What it is

`qrcodr-web` is a single-page React app that generates scannable QR codes from any text or URL payload, with stylistic options that go well beyond the usual black-and-white grid. It's a browser port of the [Python `qrcodr` desktop app](https://github.com/mriffle/qrcodr), reimagined as a zero-install web tool.

Everything runs in the browser. There is no server, no analytics, and no network call after the initial page load. The page is fully usable offline once cached.

## Features

- **PNG export** — high-resolution 1024×1024 raster, ready for print or sharing
- **SVG export** — infinitely scalable vector, ready for design tools
- **Custom colors** — pick any foreground and background hex pair with the inline color pickers
- **Module shape** — choose between crisp **square** modules or smooth **rounded** modules (adjacent modules merge into pills; isolated modules become circles)
- **Center icons** — drop a decorative icon into the middle of the code (anchor, cat, crown, dinosaur, fish, flame, ghost, heart, leaf, lightning, moon, mushroom, music note, paw print, rocket, skull, smiley, snowflake, star, sun)
- **Center text** — add a short label (up to 10 characters) below the icon or on its own
- **Live preview** — see the QR update as you type, with an operative-HUD viewport (corner brackets, reticle crosshair, lime bloom)
- **Telemetry panel** — see version, module count, error-correction level, and quiet zone at a glance
- **Maximum error correction (level H, ~30%)** — center icons and labels stay scannable across every phone camera in the E2E suite
- **Up to 1,273 characters** — supports the full version-40 byte-mode capacity
- **Mobile-ready** — responsive layout collapses to a single column under 920px
- **Reduced-motion aware** — ambient effects (scanlines, pulse, caret blink) disable themselves for users who opt out
- **Accessible** — visible focus rings, proper ARIA roles on every control, WCAG-AA text contrast

## Privacy

Everything stays in your browser. There is no backend. Your payload is not sent anywhere, not logged anywhere, and not stored anywhere. The exports are generated entirely with client-side JavaScript and downloaded directly from your machine.

## Local development

```bash
npm install
npm run dev            # Vite dev server on :5173 (HMR)
npm run build          # production build
npm run preview        # serve the build
npm run check          # format + lint + typecheck + tests
npm run test:e2e       # Playwright (builds + previews automatically)
```

## Aesthetic

A near-future operative terminal — onyx surfaces, acid-lime signal accents, hot-coral danger states, Orbitron + JetBrains Mono type pairing, layered radial gradients with CRT scanlines and a vignette. The QR sits inside a viewport with HUD corner brackets and a reticle crosshair, lime bloom radiating from a white module square.

## License

See [LICENSE](LICENSE).
