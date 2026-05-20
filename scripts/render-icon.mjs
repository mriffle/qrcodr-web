#!/usr/bin/env node
// Render one or more center-icon SVGs to PNGs for visual review.
//
// Usage:
//   node scripts/render-icon.mjs <icon-name> [<icon-name> ...]
//   node scripts/render-icon.mjs --all
//
// Output: tmp/icon-previews/<name>.png (overwritten each run)
//
// The icon files at src/assets/center-icons/*.svg use fill="currentColor"
// so they can paint in any foreground color at runtime. This script
// substitutes currentColor with a concrete dark blue and rasterizes
// against a light bone-colored background — mirroring the app's default
// palette, which is where the user most likely spots quality issues.

import sharp from 'sharp';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const ICONS_DIR = resolve(PROJECT_ROOT, 'src/assets/center-icons');
const PREVIEW_DIR = resolve(PROJECT_ROOT, 'tmp/icon-previews');

// 400px is large enough to see flaws clearly. The icon will actually
// render at ~64–160px in the app, so anything indistinct at that size
// will be invisible in practice — keep that in mind when reviewing.
const SIZE = 400;
const FOREGROUND = '#0f1b3d';
const BACKGROUND = { r: 240, g: 237, b: 226, alpha: 1 };

async function renderIcon(name) {
  const inputPath = resolve(ICONS_DIR, `${name}.svg`);
  const svg = await readFile(inputPath, 'utf-8');
  // Resolve currentColor so sharp paints with a concrete color.
  const resolved = svg.replaceAll('currentColor', FOREGROUND);
  const png = await sharp(Buffer.from(resolved), { density: 384 })
    .resize(SIZE, SIZE, { fit: 'contain', background: BACKGROUND })
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer();
  await mkdir(PREVIEW_DIR, { recursive: true });
  const outPath = resolve(PREVIEW_DIR, `${name}.png`);
  await writeFile(outPath, png);
  return outPath;
}

async function listAllIcons() {
  const files = await readdir(ICONS_DIR);
  return files.filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/render-icon.mjs <icon-name> [<icon-name> ...] | --all');
  process.exit(1);
}

const names = args.includes('--all') ? await listAllIcons() : args;
for (const name of names) {
  const out = await renderIcon(name);
  console.log(out);
}
