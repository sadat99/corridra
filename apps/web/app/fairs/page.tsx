import { notFound } from 'next/navigation';
import { FairsIndexView } from '../../components/fairs-view';
import { WorkspaceShell } from '../../components/workspace-shell';
import { fairs } from '../../content/fairs';
import { publishableFairs } from '../../lib/fairs';
import { uxSwitchOn } from '../../lib/ux-switches';
import './fairs.css';

export const revalidate = 3600;
export const metadata = {
  title: 'Trade fairs | Corridra',
  robots: { index: false, follow: false },
};

/**
 * A reading page: the fairs the Corridra team has checked, and the day each was last checked. With the
 * switch off this is the plain not found page. The list is empty until a person adds a checked entry.
 */
export default function Page() {
  if (!uxSwitchOn('CORRIDRA_UX_FAIRS')) notFound();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <WorkspaceShell eyebrow="TRADE FAIRS" title="Fairs we have checked.">
      <FairsIndexView list={publishableFairs(fairs, today)} today={today} />
    </WorkspaceShell>
  );
}
