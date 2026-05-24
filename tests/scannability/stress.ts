/**
 * Field-degradation transforms. Each takes a high-res master PNG buffer and
 * an intensity, and returns decoded-ready RGBA pixels. The intensities are
 * ordered so that *higher index = harder* for the runner's threshold search.
 */
import sharp from 'sharp';

export type Rgba = { rgba: Uint8ClampedArray; width: number; height: number };

async function toRgba(buf: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

const WHITE = { r: 240, g: 237, b: 226, alpha: 1 };

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
    .resize(256, 256, { fit: 'contain', background: WHITE })
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
    .resize(256, 256, { fit: 'contain', background: WHITE })
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
];
