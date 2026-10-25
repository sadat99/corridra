import { notFound } from 'next/navigation';
import { FairDetailView } from '../../../components/fairs-view';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { fairs } from '../../../content/fairs';
import { publishableFairs } from '../../../lib/fairs';
import { uxSwitchOn } from '../../../lib/ux-switches';
import '../fairs.css';

export const revalidate = 3600;
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const today = new Date().toISOString().slice(0, 10);
  // With the switch off the title is the generic one, so no fair name reaches a page that is not found.
  const fair = uxSwitchOn('CORRIDRA_UX_FAIRS')
    ? publishableFairs(fairs, today).find((item) => item.slug === slug)
    : undefined;
  return {
    title: fair ? `${fair.name} | Corridra` : 'Trade fair | Corridra',
    robots: { index: false, follow: false },
  };
}

/** One fair: its stated dates with the source, who read them and when. Any address that is not a checked fair is not found. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!uxSwitchOn('CORRIDRA_UX_FAIRS')) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const slug = (await params).slug;
  const found = publishableFairs(fairs, today).find((item) => item.slug === slug);
  if (!found) notFound();
  return (
    <WorkspaceShell eyebrow="TRADE FAIR" title={found.name}>
      <FairDetailView fair={found} today={today} />
    </WorkspaceShell>
  );
}
