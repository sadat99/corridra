import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// ADR-088. Every profile picture is checked from its real bytes and redrawn on the server before anything is stored:
// only JPEG, PNG and WebP, no animation, no SVG or any other type, at most 8 MiB, each side 128 to 8000 pixels and at most
// 40 million pixels. The redraw makes two square WebP files (512 and 96 pixels, sRGB) and keeps no metadata at all, so EXIF
// (including location), XMP, ICC and comments are gone. The uploaded bytes are never stored. Malware scanning is deferred
// for this repository (ADR-056); decoding and redrawing every image is the control that stands in its place.
export const pictureLimits = {
  maxBytes: 8 * 1024 * 1024,
  minSide: 128,
  maxSide: 8000,
  maxPixels: 40_000_000,
  large: 512,
  small: 96,
} as const;
export type PictureKind = 'jpeg' | 'png' | 'webp';
export type PictureRefusal =
  | 'too_large'
  | 'empty'
  | 'wrong_type'
  | 'animated'
  | 'too_small'
  | 'too_big_in_pixels'
  | 'unreadable';
export class PictureRejected extends Error {
  constructor(readonly reason: PictureRefusal) {
    super(reason);
  }
}
// Plain words the screen shows for each refusal.
export const pictureRefusalWords: Record<PictureRefusal, string> = {
  too_large: 'This picture is larger than 8 MB. Choose a smaller one.',
  empty: 'This file is empty. Choose a picture.',
  wrong_type: 'Use a JPEG, PNG or WebP picture.',
  animated: 'Moving pictures are not supported. Choose a still picture.',
  too_small: 'This picture is too small. Use one at least 128 pixels on each side.',
  too_big_in_pixels: 'This picture has too many pixels. Use one under 8000 pixels on each side.',
  unreadable: 'This picture could not be read. Try another file.',
};

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  Buffer.from(bytes.subarray(at, at + length)).toString('latin1');
const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
const u32le = (bytes: Uint8Array, at: number) =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

// A PNG with an animation control chunk before its image data is an animated PNG.
function animatedPng(bytes: Uint8Array) {
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = u32(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + length;
  }
  return false;
}
// A WebP whose extended header sets the animation flag, or that holds an animation chunk, is animated.
function animatedWebp(bytes: Uint8Array) {
  if (ascii(bytes, 12, 4) === 'VP8X' && bytes.length > 20 && (bytes[20]! & 0x02) !== 0) return true;
  for (let at = 12; at + 8 <= bytes.length;) {
    const type = ascii(bytes, at, 4);
    if (type === 'ANIM' || type === 'ANMF') return true;
    at += 8 + u32le(bytes, at + 4) + (u32le(bytes, at + 4) % 2);
  }
  return false;
}

// What the bytes are, whatever the browser said they were.
export function sniffPicture(bytes: Uint8Array): PictureKind {
  if (!bytes.length) throw new PictureRejected('empty');
  if (bytes.length > pictureLimits.maxBytes) throw new PictureRejected('too_large');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    if (animatedPng(bytes)) throw new PictureRejected('animated');
    return 'png';
  }
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    if (animatedWebp(bytes)) throw new PictureRejected('animated');
    return 'webp';
  }
  throw new PictureRejected('wrong_type');
}

export type ProcessedPicture = {
  uploadSha256: string;
  large: { body: Buffer; sha256: string; bytes: number };
  small: { body: Buffer; sha256: string; bytes: number };
};
const digest = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
sharp.cache(false);
// One decode thread per picture: a large picture costs one core and its own working memory, never every core at once.
sharp.concurrency(1);

export async function processPicture(bytes: Uint8Array): Promise<ProcessedPicture> {
  const kind = sniffPicture(bytes);
  const input = Buffer.from(bytes);
  const open = () =>
    sharp(input, {
      limitInputPixels: pictureLimits.maxPixels,
      failOn: 'error',
      animated: false,
      // Decode top to bottom in strips instead of holding the whole decoded picture for random access.
      sequentialRead: true,
    }).timeout({ seconds: 10 });
  let meta: Awaited<ReturnType<ReturnType<typeof open>['metadata']>>;
  try {
    meta = await open().metadata();
  } catch (error) {
    if (/pixel limit/i.test((error as Error).message ?? ''))
      throw new PictureRejected('too_big_in_pixels');
    throw new PictureRejected('unreadable');
  }
  // The decoder must agree with the sniffed type, so a file that only starts like an image is refused.
  if (meta.format !== kind) throw new PictureRejected('wrong_type');
  if ((meta.pages ?? 1) > 1) throw new PictureRejected('animated');
  const width = meta.width ?? 0,
    height = meta.height ?? 0;
  if (width > pictureLimits.maxSide || height > pictureLimits.maxSide)
    throw new PictureRejected('too_big_in_pixels');
  if (width * height > pictureLimits.maxPixels) throw new PictureRejected('too_big_in_pixels');
  if (width < pictureLimits.minSide || height < pictureLimits.minSide)
    throw new PictureRejected('too_small');
  let large: Buffer, small: Buffer;
  try {
    // rotate() applies the camera orientation, then nothing of the original metadata is written: sharp keeps no EXIF, XMP,
    // ICC or comment unless asked with keepMetadata or withMetadata, and neither is used here.
    large = await open()
      .rotate()
      .resize(pictureLimits.large, pictureLimits.large, { fit: 'cover', position: 'centre' })
      .toColourspace('srgb')
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    small = await sharp(large, { failOn: 'error' })
      .resize(pictureLimits.small, pictureLimits.small, { fit: 'cover' })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch {
    throw new PictureRejected('unreadable');
  }
  return {
    uploadSha256: digest(input),
    large: { body: large, sha256: digest(large), bytes: large.length },
    small: { body: small, sha256: digest(small), bytes: small.length },
  };
}
