import Link from 'next/link';
import { cookies } from 'next/headers';
import { AccessOptions } from '../../../components/access-options';
import { accessHelp } from '../../../lib/access-doors';
import { WorkAccess } from '../../../components/work-access';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { OperatorSignin } from './signin-form';
import { operatorReturnTo } from '../../../lib/workspace-navigation';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { OperatorInvitationHint } from '../../../components/operator-invitation-hint';
import { InvitationHintRefresh } from '../../../components/invitation-hint-refresh';
import { customerSessionHinted } from '../../../lib/customer-session-hint';
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
        <Link prefetch={false} className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link prefetch={false} className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  // Signed out of the customer account, there is no invitation to find and nothing is asked; coming back to the
  // tab draws the page again, so a customer sign-in in another tab still brings the hint.
  const hint = customerSessionHinted((await cookies()).getAll()) ? (
    <OperatorInvitationHint />
  ) : (
    <InvitationHintRefresh />
  );
  // The work sign-in window (owner canvas board v12), live by default; set to "false", the earlier page exactly.
  if (uxSwitchOn('CORRIDRA_UX_WORK_SIGNIN_V12'))
    return (
      <WorkAccess initial="team" teamReturn={returnTo} helperReturn="/contributor" hint={hint} />
    );
  return (
    <WorkspaceShell eyebrow="OPERATOR ACCESS" title="Sign in to your workspace." compact>
      {hint}
      <OperatorSignin returnTo={returnTo} />
      <Link prefetch={false} className="text-link" href="/operator/forgot-password">
        Forgot operator password?
      </Link>
      <AccessOptions {...accessHelp.operatorSignIn(returnTo)} />
    </WorkspaceShell>
  );
}
