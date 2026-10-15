import Link from 'next/link';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { OperatorSignin } from './signin-form';
import { operatorReturnTo } from '../../../lib/workspace-navigation';
import { OperatorInvitationHint } from '../../../components/operator-invitation-hint';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator sign-in | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  const returnTo = operatorReturnTo(next);
  if (!foundations())
    return (
      <WorkspaceShell eyebrow="OPERATOR ACCESS" title="Workspace sign-in is unavailable." compact>
        <p>Workspace access is not configured here. This page does not collect credentials.</p>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  return (
    <WorkspaceShell eyebrow="OPERATOR ACCESS" title="Sign in to your workspace." compact>
      <OperatorInvitationHint />
      <OperatorSignin returnTo={returnTo} />
      <Link className="text-link" href="/operator/forgot-password">
        Forgot operator password?
      </Link>
      <nav className="access-options" aria-label="Sign-in alternatives">
        <Link className="text-link" href="/operator/setup">
          Set up invited operator access
        </Link>
        <Link className="text-link" href="/workspace">
          All workspaces and tools
        </Link>
        <Link className="text-link" href="/signin">
          Customer account sign-in
        </Link>
        <Link className="text-link" href="/contributor">
          Assigned-task invitation help
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </nav>
    </WorkspaceShell>
  );
}
