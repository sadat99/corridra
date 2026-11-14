import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { pp } from '../../../lib/i18n/programme-pages';
import { readPublishedPage, type PublishedPage } from '../../../lib/programme-share-kit';
import { ProgrammePageView } from './programme-page-view';
import { shareKitParts } from './share-kit';
import './programme-page.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The public page of one programme (ADR-080). It shows only the words the organiser reviewed and published. Any
// address that is not a readable page (unknown, taken down, archived, long closed, the switch off) is not found.
async function read(address: string): Promise<PublishedPage | null> {
  return readPublishedPage(address);
}
const clip = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const found = await read((await params).address).catch(() => null);
  // An address that opens nothing gets the generic title, so no programme name reaches a page that is not found.
  if (!found) return { title: pp('pp.public.metaTitle'), robots: { index: false } };
  const { page, origin, kit } = found;
  const title = `${page.programme.title} | Corridra`;
  const description = clip(page.programme.summary, 200);
  const url = `${origin}/delegations/${page.address}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    // Owner decision, 11 Nov 2026: no programme page is offered to search engines, sample or real. A page is
    // reached through the address its organiser shares.
    robots: { index: false, follow: false },
    // With the share kit on, the page has its own preview image, made from the published words only. Off, the page
    // carries no image of its own, exactly as before.
    openGraph: {
      title: page.programme.title,
      description,
      url,
      type: 'website',
      ...(kit ? { images: [{ url: `${url}/preview-image`, width: 1200, height: 630 }] } : {}),
    },
    twitter: kit
      ? {
          card: 'summary_large_image',
          title: page.programme.title,
          description,
          images: [`${url}/preview-image`],
        }
      : { card: 'summary', title: page.programme.title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const found = await read((await params).address);
  if (!found) notFound();
  const { page, origin, kit, schedule } = found;
  const url = `${origin}/delegations/${page.address}`;
  return (
    <WorkspaceShell
      className="programme-page"
      eyebrow={page.sample ? pp('pp.public.eyebrowSample') : pp('pp.public.eyebrow')}
      title={page.programme.title}
    >
      <ProgrammePageView
        page={page}
        url={url}
        shareKit={
          kit ? shareKitParts({ address: page.address, calendar: schedule !== null }) : undefined
        }
      />
    </WorkspaceShell>
  );
}
