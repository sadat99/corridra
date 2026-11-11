import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  customerProgrammePagesEnabled,
  type PublicProgrammePage,
} from '@corridra/auth/customer-programme-publication';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { pp } from '../../../lib/i18n/programme-pages';
import { ProgrammePageView } from './programme-page-view';
import './programme-page.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The public page of one programme (ADR-080). It shows only the words the organiser reviewed and published. Any
// address that is not a readable page (unknown, taken down, archived, long closed, the switch off) is not found.
async function read(
  address: string,
): Promise<{ page: PublicProgrammePage; origin: string } | null> {
  if (!customerProgrammePagesEnabled()) return null;
  const s = foundations();
  if (!s) return null;
  await s.ready;
  const page = await s.programmePageReader.read(address);
  return page.state === 'unknown' ? null : { page, origin: s.config.APP_ORIGIN };
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
  const { page, origin } = found;
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
    openGraph: { title: page.programme.title, description, url, type: 'website' },
    twitter: { card: 'summary', title: page.programme.title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const found = await read((await params).address);
  if (!found) notFound();
  const { page, origin } = found;
  return (
    <WorkspaceShell
      className="programme-page"
      eyebrow={page.sample ? pp('pp.public.eyebrowSample') : pp('pp.public.eyebrow')}
      title={page.programme.title}
    >
      <ProgrammePageView page={page} url={`${origin}/delegations/${page.address}`} />
    </WorkspaceShell>
  );
}
