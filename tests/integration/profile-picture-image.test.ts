import { describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
// sharp is a dependency of apps/web only; the tests load that copy.
import type SharpType from '../../apps/web/node_modules/sharp';

vi.mock('server-only', () => ({}));
const sharp = createRequire(resolve('apps/web/package.json'))('sharp') as typeof SharpType;
const { processPicture, sniffPicture, PictureRejected, pictureLimits } =
  await import('../../apps/web/lib/profile-picture-image');

// ADR-088. The server check of a profile picture: the real bytes decide the type (JPEG, PNG or WebP only), animation and
// SVG are refused, size and pixel limits hold, and the redraw keeps no metadata at all (EXIF location included).
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 80, b: 200 } } });
const reason = async (work: () => unknown) => {
  try {
    await work();
  } catch (error) {
    if (error instanceof PictureRejected) return error.reason;
    throw error;
  }
  return 'accepted';
};
// Inserts a PNG chunk (with a zero CRC, which the sniff does not read) right after the header chunk.
function withPngChunk(png: Buffer, type: string) {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  const chunk = Buffer.alloc(12 + 8);
  chunk.writeUInt32BE(8, 0);
  chunk.write(type, 4, 'latin1');
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

describe('the type comes from the bytes', () => {
  test('JPEG, PNG and WebP are accepted', async () => {
    expect(sniffPicture(await solid(200, 200).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffPicture(await solid(200, 200).png().toBuffer())).toBe('png');
    expect(sniffPicture(await solid(200, 200).webp().toBuffer())).toBe('webp');
  });
  test('SVG, GIF, HTML and a renamed text file are refused as the wrong type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><script>alert(1)</script></svg>',
    );
    expect(await reason(() => processPicture(svg))).toBe('wrong_type');
    expect(await reason(async () => processPicture(await solid(200, 200).gif().toBuffer()))).toBe(
      'wrong_type',
    );
    expect(await reason(() => processPicture(Buffer.from('<html><body>hi</body></html>')))).toBe(
      'wrong_type',
    );
    // A TIFF that a browser might label image/jpeg.
    expect(await reason(async () => processPicture(await solid(200, 200).tiff().toBuffer()))).toBe(
      'wrong_type',
    );
  });
  test('a file that only starts like a JPEG is refused', async () => {
    const spoof = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<svg>x</svg>')]);
    expect(await reason(() => processPicture(spoof))).toBe('unreadable');
    // PNG bytes behind a JPEG start are refused by the decoder's own reading of the type.
    const png = await solid(200, 200).png().toBuffer();
    expect(
      await reason(() => processPicture(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png]))),
    ).not.toBe('accepted');
  });
  test('animated PNG and animated WebP are refused', async () => {
    const png = await solid(200, 200).png().toBuffer();
    expect(await reason(() => processPicture(withPngChunk(png, 'acTL')))).toBe('animated');
    const webp = await solid(200, 200).webp({ lossless: true }).toBuffer();
    // An extended WebP header with the animation flag set.
    const vp8x = Buffer.alloc(18);
    vp8x.write('VP8X', 0, 'latin1');
    vp8x.writeUInt32LE(10, 4);
    vp8x[8] = 0x02;
    const animated = Buffer.concat([webp.subarray(0, 12), vp8x, webp.subarray(12)]);
    animated.writeUInt32LE(animated.length - 8, 4);
    expect(await reason(() => processPicture(animated))).toBe('animated');
  });
});

describe('limits', () => {
  test('empty and larger than 8 MiB are refused before decoding', async () => {
    expect(await reason(() => processPicture(Buffer.alloc(0)))).toBe('empty');
    const big = Buffer.alloc(pictureLimits.maxBytes + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(await reason(() => processPicture(big))).toBe('too_large');
  });
  test('too small, too wide and too many pixels are refused', async () => {
    expect(await reason(async () => processPicture(await solid(100, 300).png().toBuffer()))).toBe(
      'too_small',
    );
    expect(await reason(async () => processPicture(await solid(8001, 200).png().toBuffer()))).toBe(
      'too_big_in_pixels',
    );
    expect(await reason(async () => processPicture(await solid(7000, 7000).png().toBuffer()))).toBe(
      'too_big_in_pixels',
    );
  });
});

describe('the redraw', () => {
  test('makes square 512 and 96 WebP files with no metadata, location included', async () => {
    const tagged = await solid(1200, 800)
      .jpeg()
      .withExif({
        IFD0: { Make: 'SyntheticCamZebra', Copyright: 'Synthetic owner zebra' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '1/1 17/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '103/1 50/1 0/1',
        },
      })
      .toBuffer();
    const before = await sharp(tagged).metadata();
    expect(before.exif).toBeDefined();
    const out = await processPicture(tagged);
    for (const [file, side] of [
      [out.large, 512],
      [out.small, 96],
    ] as const) {
      const meta = await sharp(file.body).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: side, height: side });
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      const raw = file.body.toString('latin1');
      for (const word of ['Exif', 'SyntheticCamZebra', 'zebra', 'GPS', 'XMP '])
        expect(raw).not.toContain(word);
      expect(file.bytes).toBe(file.body.length);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(out.uploadSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('drops an embedded colour profile from both files', async () => {
    const profiled = await solid(600, 400).jpeg().withIccProfile('p3').toBuffer();
    const before = await sharp(profiled).metadata();
    expect(before.icc).toBeDefined();
    expect(before.icc!.length).toBeGreaterThan(100);
    const out = await processPicture(profiled);
    for (const file of [out.large, out.small]) {
      const meta = await sharp(file.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.icc).toBeUndefined();
      expect(file.body.toString('latin1')).not.toContain('ICCP');
    }
  });
  test('a 16-bit PNG of 40 million pixels is redrawn within the time and memory bounds', async () => {
    // ADR-088 keeps 40 million pixels: measured on 17 November 2026 at about 0.5 s and 89 MiB of extra memory; the bound
    // stated here is under 10 s and under 256 MiB of extra resident memory.
    const deep = await sharp({
      create: { width: 8000, height: 5000, channels: 3, background: { r: 30, g: 80, b: 200 } },
    })
      .toColourspace('rgb16')
      .png({ compressionLevel: 9 })
      .toBuffer();
    const meta = await sharp(deep).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 8000, height: 5000, depth: 'ushort' });
    expect(deep.length).toBeLessThanOrEqual(pictureLimits.maxBytes);
    let peak = process.memoryUsage().rss;
    const start = process.memoryUsage().rss,
      began = Date.now();
    const sample = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 5);
    try {
      const out = await processPicture(deep);
      expect(await sharp(out.large.body).metadata()).toMatchObject({ width: 512, height: 512 });
    } finally {
      clearInterval(sample);
    }
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(peak - start).toBeLessThan(256 * 1024 * 1024);
  });
  test('applies the camera orientation before dropping it', async () => {
    // A tall left half red, right half blue, stored sideways with orientation 6 (rotate 90 degrees clockwise to show).
    const half = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 400, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
          })
            .png()
            .toBuffer(),
          top: 100,
          left: 0,
        },
      ])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processPicture(half);
    const { data } = await sharp(out.large.body).raw().toBuffer({ resolveWithObject: true });
    // After rotating, the blue bottom band of the stored image is on the left.
    const left = data[(256 * 512 + 10) * 3 + 2]!;
    const right = data[(256 * 512 + 500) * 3]!;
    expect(left).toBeGreaterThan(200);
    expect(right).toBeGreaterThan(200);
  });
});
