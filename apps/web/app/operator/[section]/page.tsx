import '../operator-overview.css';
import { notFound } from 'next/navigation';
import { sectionForSlug } from '../../../lib/operator-urls';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { OperatorEntry } from '../operator-entry';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator workspace | Corridra',
  robots: { index: false, follow: false },
};

/**
 * One section of the team workspace at its own address (Lane 9). With the switch off, or for any word
 * that is not one of the closed list, this is the same plain "not found" page any unknown address gets.
 * The pages that already live under /operator (owner, setup, signin and the rest) are real folders and
 * are matched first; they are listed in operator-urls.ts and checked by a test.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ workspace?: string }>;
}) {
  if (!uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')) notFound();
  const section = sectionForSlug((await params).section);
  if (!section) notFound();
  return <OperatorEntry requested={(await searchParams).workspace} section={section} />;
}
