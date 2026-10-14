import { WorkspaceShell } from '../../components/workspace-shell';
import type { Metadata } from 'next';
import { BuyerIntroduction } from './introduction';
import Link from 'next/link';
export const metadata: Metadata = {
  title: 'Private introduction | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function BuyerPage() {
  return (
    <WorkspaceShell
      eyebrow="Private introduction from Corridra"
      title="Would this company be relevant to you?"
    >
      <BuyerIntroduction />
      <nav className="access-options" aria-label="Private introduction help">
        <Link className="text-link" href="/workspace">
          Workspace and invitation help
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </nav>
    </WorkspaceShell>
  );
}
