import { describe, expect, test, vi } from 'vitest';

// ADR-088. How the server redraw drives the decoder, checked by wrapping the real sharp: every decode of the upload reads
// sequentially under the pixel limit, one decode thread per picture, and a failure in any redraw step, the small file
// included, is the plain "unreadable" refusal (422), never an unexplained server error.
const seen: { options: Record<string, unknown> | undefined }[] = [];
let failSmall = false;
vi.mock('server-only', () => ({}));
vi.mock(import('../../apps/web/node_modules/sharp/dist/index.mjs'), async (original) => {
  const real = (await original()).default;
  const wrapped = ((input?: unknown, options?: Record<string, unknown>) => {
    const instance = real(input as Buffer, options);
    seen.push({ options });
    // The small file is the only step that reads a WebP the server drew itself.
    const drawnWebp = Buffer.isBuffer(input) && input.subarray(8, 12).toString('latin1') === 'WEBP';
    if (failSmall && drawnWebp && !options?.limitInputPixels) {
      instance.toBuffer = (() =>
        Promise.reject(new Error('synthetic small re-encode failure'))) as never;
    }
    return instance;
  }) as unknown as typeof real;
  Object.assign(wrapped, real);
  return { default: wrapped };
});
const sharp = (await import('../../apps/web/node_modules/sharp/dist/index.mjs')).default;
const { processPicture, PictureRejected } =
  await import('../../apps/web/lib/profile-picture-image');

const upload = () =>
  sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 120, b: 60 } } })
    .png()
    .toBuffer();

describe('the redraw steps', () => {
  test('decodes the upload sequentially under the pixel limit, one thread per picture', async () => {
    seen.length = 0;
    failSmall = false;
    await processPicture(await upload());
    const decodes = seen.filter((call) => call.options?.limitInputPixels);
    expect(decodes.length).toBeGreaterThanOrEqual(2);
    for (const call of decodes)
      expect(call.options).toMatchObject({
        limitInputPixels: 40_000_000,
        sequentialRead: true,
        failOn: 'error',
        animated: false,
      });
    expect(sharp.concurrency()).toBe(1);
  });
  test('a failure drawing the small file is the unreadable refusal', async () => {
    failSmall = true;
    try {
      const error = await processPicture(await upload()).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(PictureRejected);
      expect((error as InstanceType<typeof PictureRejected>).reason).toBe('unreadable');
    } finally {
      failSmall = false;
    }
  });
});
