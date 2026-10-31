import './operator-overview.css';
import { uxSwitchOn } from '../../lib/ux-switches';
import { privatePageMetadata } from '../../lib/ux/page-metadata';
import { OperatorEntry } from './operator-entry';
export const dynamic = 'force-dynamic';

/** The workspace home is Today with the shells switch on (CQ-36); off, the title as before. */
export function generateMetadata() {
  return uxSwitchOn('CORRIDRA_UX_SHELLS_V2')
    ? privatePageMetadata('Today')
    : { title: 'Operator workspace | Corridra', robots: { index: false, follow: false } };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  return <OperatorEntry requested={(await searchParams).workspace} />;
}
