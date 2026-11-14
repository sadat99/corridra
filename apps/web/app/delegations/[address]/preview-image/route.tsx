import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { previewImage } from '../../../../lib/programme-preview-image';
import { readShareKitPage } from '../../../../lib/programme-share-kit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The preview image of a public programme page (ADR-084 S1). It is built only from the published title, where, when and
// organiser, with the word Sample in a sample workspace, and no private programme is read. Every address that is not a
// readable page, and the share kit switched off, answer the same single 404.
const nothing = () =>
  new Response(null, {
    status: 404,
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
  const found = await readShareKitPage((await params).address).catch(() => null);
  if (!found) return nothing();
  const { programme: p, sample } = found.page;
  return new ImageResponse(
    previewImage({
      title: p.title,
      destination: p.destination,
      dates: p.dates,
      organiser: p.organiser,
      sample,
      mark: await orb(),
    }),
    {
      width: 1200,
      height: 630,
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
    },
  );
}
