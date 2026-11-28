import Link from 'next/link';
import { cookies } from 'next/headers';
import { WorkAccess } from '../../../components/work-access';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { operatorReturnTo } from '../../../lib/workspace-navigation';
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
  return (
    <WorkAccess
      initial="team"
      teamReturn={returnTo}
      helperReturn="/contributor"
      hint={
        // Signed out of the customer account, there is no invitation to find and nothing is asked; coming back to the
        // tab draws the page again, so a customer sign-in in another tab still brings the hint.
        customerSessionHinted((await cookies()).getAll()) ? (
          <OperatorInvitationHint />
        ) : (
          <InvitationHintRefresh />
        )
      }
    />
  );
}
