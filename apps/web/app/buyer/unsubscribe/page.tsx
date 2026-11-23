import type { Metadata } from 'next';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { StopEmails } from './stop-emails';
export const metadata: Metadata = {
  title: 'Stop emails | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
// ADR-090. Opening this page changes nothing. Only the button sends the opt-out.
export default function UnsubscribePage() {
  return (
    <WorkspaceShell eyebrow="Emails from the Corridra team" title="Stop emails to this address">
      <StopEmails />
    </WorkspaceShell>
  );
}
