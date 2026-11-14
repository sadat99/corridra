import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { previewImage } from '../../../../lib/programme-preview-image';
import { previewFont } from '../../../../lib/programme-preview-font';
import { readShareKitPage } from '../../../../lib/programme-share-kit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The preview image of a public programme page (ADR-084 S1). It is built only from the published title, where, when and
// organiser, with the word Sample in a sample workspace, and no private programme is read. Every address that is not a
// readable page, and the share kit switched off, answer the same single 404. A database that cannot be read right now
// answers 503 and is never cached, so a chat app does not keep a missing picture for a page that exists. The picture is
// drawn with one bundled font and makes no network call (see programme-preview-font.ts); if drawing it fails for any
// reason the answer is the same plain 404, never a 500.
const nothing = () =>
  new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
const unavailable = () =>
  new Response(null, {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

// The owned reversed orb file, from the web application folder (where `next start` runs) or from the repository root. Each
// path is fixed text under public/brand, so only that file is traced into the deployment.
const asAddress = (file: Buffer) => `data:image/svg+xml;base64,${file.toString('base64')}`;
async function orb(): Promise<string | null> {
  try {
    return asAddress(
      await readFile(join(process.cwd(), 'public', 'brand', 'corridra-orb-reversed.svg')),
    );
  } catch {
    /* Try the repository root next. */
  }
  try {
    return asAddress(
      await readFile(
        join(process.cwd(), 'apps', 'web', 'public', 'brand', 'corridra-orb-reversed.svg'),
      ),
    );
  } catch {
    /* Without the mark the image still says what the page is. */
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  let found: Awaited<ReturnType<typeof readShareKitPage>>;
  try {
    found = await readShareKitPage((await params).address);
  } catch {
    return unavailable();
  }
  if (!found) return nothing();
  const { programme: p, sample } = found.page;
  try {
    const font = await previewFont();
    const picture = new ImageResponse(
      previewImage(
        {
          title: p.title,
          destination: p.destination,
          dates: p.dates,
          organiser: p.organiser,
          sample,
          mark: await orb(),
        },
        font.covers,
      ),
      {
        width: 1200,
        height: 630,
        fonts: [{ name: font.name, data: font.data, weight: font.weight, style: font.style }],
      },
    );
    // The picture is drawn while its body is read, so read it here: a failure is caught and answered, not streamed as a 500.
    const png = new Uint8Array(await picture.arrayBuffer());
    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return nothing();
  }
}
