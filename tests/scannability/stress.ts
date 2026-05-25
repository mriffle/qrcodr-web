/**
 * Field-degradation transforms. Each takes a high-res master PNG buffer and
 * an intensity, and returns decoded-ready RGBA pixels. The intensities are
 * ordered so that *higher index = harder* for the runner's threshold search.
 *
 * The first four (shrink/blur/lowContrast/shear) are the original battery.
 * The rest model the rest of what a phone camera does to a code on a screen
 * or print: rotation, true off-axis perspective (a projective warp, not the
 * affine approximation `shear` gives), JPEG/screenshot compression blocking,
 * specular glare, sensor noise, and partial occlusion (a finger/sticker).
 */
import sharp from 'sharp';

export type Rgba = { rgba: Uint8ClampedArray; width: number; height: number };

const RENDER = 256; // working square for transforms that normalize size first
const WHITE = { r: 240, g: 237, b: 226, alpha: 1 };
const WHITE_BYTES = [WHITE.r, WHITE.g, WHITE.b] as const;

async function toRgba(buf: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/** Normalize a master to a `px`-square RGBA-on-WHITE working image. */
async function normalize(master: Buffer, px = RENDER): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(px, px, { fit: 'contain', background: WHITE })
    .png()
    .toBuffer();
  return toRgba(buf);
}

/** Shrink to `px` square (simulates scanning from a distance). */
export async function shrink(master: Buffer, px: number): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(px, px, { fit: 'contain', background: WHITE })
    .png()
    .toBuffer();
  return toRgba(buf);
}

/** Gaussian blur at sigma (simulates out-of-focus / motion). */
export async function blur(master: Buffer, sigma: number): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(RENDER, RENDER, { fit: 'contain', background: WHITE })
    .blur(sigma)
    .png()
    .toBuffer();
  return toRgba(buf);
}

/**
 * Reduce contrast to a fraction `c` of full range, centered on mid-grey
 * (simulates faded print, glare, dim screen). out = c*in + 127.5*(1-c).
 */
export async function lowContrast(master: Buffer, c: number): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(RENDER, RENDER, { fit: 'contain', background: WHITE })
    .linear(c, 127.5 * (1 - c))
    .png()
    .toBuffer();
  return toRgba(buf);
}

/**
 * Horizontal shear by factor `s` then a small downscale (approximates an
 * off-axis viewing angle — this is where alignment patterns earn their keep).
 */
export async function shear(master: Buffer, s: number): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(220, 220, { fit: 'contain', background: WHITE })
    .affine(
      [
        [1, s],
        [s * 0.4, 1],
      ],
      { background: WHITE },
    )
    .png()
    .toBuffer();
  return toRgba(buf);
}

/** Rotate by `deg` degrees about the center, padding with the page color. */
export async function rotate(master: Buffer, deg: number): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(RENDER, RENDER, { fit: 'contain', background: WHITE })
    .rotate(deg, { background: WHITE })
    .png()
    .toBuffer();
  return toRgba(buf);
}

/**
 * JPEG round-trip at quality `q` (simulates a screenshot or messaging-app
 * recompress). Blocky 8×8 ringing around the high-contrast module edges is
 * a real-world failure mode a clean PNG decode never sees.
 */
export async function jpeg(master: Buffer, q: number): Promise<Rgba> {
  const buf = await sharp(master)
    .resize(RENDER, RENDER, { fit: 'contain', background: WHITE })
    .jpeg({ quality: q })
    .toBuffer();
  return toRgba(buf);
}

/**
 * Specular glare: a bright off-white blob lightening one quadrant, the way a
 * ceiling light reflects off a phone screen or glossy print. Implemented as a
 * radial-gradient overlay composited with `screen` so it only ever brightens.
 */
export async function glare(master: Buffer, strength: number): Promise<Rgba> {
  const base = await sharp(master)
    .resize(RENDER, RENDER, { fit: 'contain', background: WHITE })
    .png()
    .toBuffer();
  const a = Math.max(0, Math.min(1, strength));
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER}" height="${RENDER}">` +
      `<defs><radialGradient id="g" cx="32%" cy="26%" r="55%">` +
      `<stop offset="0%" stop-color="white" stop-opacity="${a}"/>` +
      `<stop offset="100%" stop-color="white" stop-opacity="0"/>` +
      `</radialGradient></defs>` +
      `<rect width="${RENDER}" height="${RENDER}" fill="url(#g)"/></svg>`,
  );
  const buf = await sharp(base)
    .composite([{ input: overlay, blend: 'screen' }])
    .png()
    .toBuffer();
  return toRgba(buf);
}

/**
 * Additive Gaussian sensor noise of standard deviation `sigma` (0–255),
 * applied per channel — the grain a phone camera adds in low light, which
 * can confuse a binarizer's threshold near module edges.
 */
export async function noise(master: Buffer, sigma: number): Promise<Rgba> {
  const img = await normalize(master);
  const { rgba } = img;
  // Deterministic PRNG (seeded per call) so the robustness guard is
  // reproducible — Math.random would make the threshold assertions flaky.
  const rand = mulberry32(0x9e3779b9 ^ Math.round(sigma * 1000));
  for (let i = 0; i < rgba.length; i += 4) {
    // Box-Muller for a unit normal, scaled by sigma; alpha left untouched.
    const u1 = rand() || 1e-9;
    const u2 = rand();
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
    rgba[i] = clamp8((rgba[i] ?? 0) + n);
    rgba[i + 1] = clamp8((rgba[i + 1] ?? 0) + n);
    rgba[i + 2] = clamp8((rgba[i + 2] ?? 0) + n);
  }
  return img;
}

/**
 * Partial occlusion: paint an opaque page-colored square covering fraction
 * `frac` of the side length at ~62% across/down — a finger or sticker over
 * data modules. Deliberately off the three finder corners so it tests the
 * error-correction budget (level H tolerates ~30% loss), not finder loss.
 */
export async function occlusion(master: Buffer, frac: number): Promise<Rgba> {
  const base = await sharp(master)
    .resize(RENDER, RENDER, { fit: 'contain', background: WHITE })
    .png()
    .toBuffer();
  const side = Math.round(RENDER * frac);
  const pos = Math.round(RENDER * 0.62);
  const left = Math.min(pos, RENDER - side);
  const patch = await sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: WHITE.r, g: WHITE.g, b: WHITE.b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const buf = await sharp(base)
    .composite([{ input: patch, left, top: left }])
    .png()
    .toBuffer();
  return toRgba(buf);
}

/**
 * True projective (perspective) warp — distinct from `shear`, which is only
 * affine and so keeps parallel lines parallel. A real off-axis photo of a
 * code converges its edges; that convergence is what the alignment patterns
 * exist to correct, so it's the most honest geometric stress we can apply.
 *
 * `amount` ∈ [0, ~0.45): the top edge is squeezed inward by `amount` of the
 * width and pushed down, tilting the plane away from the viewer.
 */
export async function perspective(master: Buffer, amount: number): Promise<Rgba> {
  const src = await normalize(master);
  const { rgba, width: w, height: h } = src;
  const dx = amount * w;
  const dy = amount * 0.35 * h;
  // Destination quad (clockwise from top-left): top edge inset + dropped.
  const dst: Corner[] = [
    [dx, dy],
    [w - dx, dy],
    [w, h],
    [0, h],
  ];
  const srcQuad: Corner[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  // Homography mapping destination pixels back to source for inverse sampling.
  const Hinv = homography(dst, srcQuad);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const [sx, sy] = applyH(Hinv, x + 0.5, y + 0.5);
      const ix = Math.round(sx - 0.5);
      const iy = Math.round(sy - 0.5);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) {
        out[o] = WHITE_BYTES[0];
        out[o + 1] = WHITE_BYTES[1];
        out[o + 2] = WHITE_BYTES[2];
        out[o + 3] = 255;
        continue;
      }
      const s = (iy * w + ix) * 4;
      out[o] = rgba[s] ?? 0;
      out[o + 1] = rgba[s + 1] ?? 0;
      out[o + 2] = rgba[s + 2] ?? 0;
      out[o + 3] = 255;
    }
  }
  return { rgba: out, width: w, height: h };
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Small fast seeded PRNG — deterministic noise so the guard never flakes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Corner = [number, number];
type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Apply a 3×3 homography to a point, returning the de-homogenized (x, y). */
function applyH(m: Mat3, x: number, y: number): Corner {
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8] || 1e-12;
  return [X / W, Y / W];
}

/**
 * Solve the 3×3 homography mapping four `from` points to four `to` points
 * via the standard 8×8 DLT linear system (h22 fixed to 1), Gauss-eliminated.
 */
function homography(from: Corner[], to: Corner[]): Mat3 {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const f = from[i];
    const t = to[i];
    if (!f || !t) throw new Error('homography needs four point pairs');
    const [x, y] = f;
    const [u, v] = t;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  const m: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 1];
  for (let i = 0; i < 8; i++) m[i] = h[i] ?? 0;
  return m;
}

/** Gaussian elimination with partial pivoting for an 8×8 system. */
function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const m = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pv = m[col]![col]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / pv;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / (row[i]! || 1e-12));
}

export type Family = {
  name: string;
  /** Levels ordered easy → hard. */
  levels: number[];
  /** Human label for a level value. */
  label: (v: number) => string;
  apply: (master: Buffer, level: number) => Promise<Rgba>;
  /** 'lowerHarder' means a smaller surviving value = more robust (e.g. px). */
  direction: 'higherHarder' | 'lowerHarder';
};

export const FAMILIES: Family[] = [
  {
    name: 'shrink',
    levels: [220, 180, 150, 130, 110, 95, 82, 72, 64, 56, 50],
    label: (v) => `${v}px`,
    apply: shrink,
    direction: 'lowerHarder',
  },
  {
    name: 'blur',
    levels: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8],
    label: (v) => `σ${v}`,
    apply: blur,
    direction: 'higherHarder',
  },
  {
    name: 'contrast',
    levels: [1, 0.8, 0.6, 0.45, 0.35, 0.27, 0.2, 0.15, 0.11, 0.08],
    label: (v) => `${Math.round(v * 100)}%`,
    apply: lowContrast,
    direction: 'lowerHarder',
  },
  {
    name: 'shear',
    levels: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9],
    label: (v) => `${v}`,
    apply: shear,
    direction: 'higherHarder',
  },
  {
    name: 'rotate',
    levels: [0, 5, 10, 15, 25, 35, 45],
    label: (v) => `${v}°`,
    apply: rotate,
    direction: 'higherHarder',
  },
  {
    name: 'jpeg',
    levels: [90, 70, 50, 35, 25, 18, 12, 8],
    label: (v) => `q${v}`,
    apply: jpeg,
    direction: 'lowerHarder',
  },
  {
    name: 'glare',
    levels: [0.2, 0.4, 0.6, 0.75, 0.85, 0.92, 0.98],
    label: (v) => `${Math.round(v * 100)}%`,
    apply: glare,
    direction: 'higherHarder',
  },
  {
    name: 'noise',
    levels: [10, 25, 40, 55, 70, 85, 100],
    label: (v) => `σ${v}`,
    apply: noise,
    direction: 'higherHarder',
  },
  {
    name: 'occlusion',
    levels: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3],
    label: (v) => `${Math.round(v * 100)}%`,
    apply: occlusion,
    direction: 'higherHarder',
  },
  {
    name: 'perspective',
    levels: [0.05, 0.1, 0.15, 0.2, 0.28, 0.36, 0.44],
    label: (v) => `${v}`,
    apply: perspective,
    direction: 'higherHarder',
  },
];
