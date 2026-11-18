import { booksForPage } from '../../../../../lib/book-availability';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../../../components/workspace-shell';
import { CustomerShell } from '../../../../../components/customer-shell';
import { neonAuth } from '../../../../../lib/neon-auth';
import { memberAccessOn } from '../../../../../lib/member-access';
import { uxSwitchOn } from '../../../../../lib/ux-switches';
import { SavedCommercialReport } from '../../../missions/saved-commercial-report';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: "Member's saved report | Corridra",
  robots: { index: false, follow: false },
};
const back = { label: "Back to Members' Reports", href: '/account?view=results&tab=members' };

// ADR-087 U5: a workspace owner or admin reads one saved report of another member of that workspace, read only, with its
// books. The page holds no identity or permission of its own: the member access route and the database decide, and every
// open is recorded there. With CORRIDRA_MEMBER_ACCESS off the page does not exist.
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; resourceId: string }>;
}) {
  if (!memberAccessOn()) notFound();
  if (!customerSavedMissionsEnabled())
    return (
      <WorkspaceShell eyebrow="REPORTS" title="Member's saved report" compact>
        <p role="status">Reports are not available right now. Try again later.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const { workspaceId, resourceId } = await params;
  const ids = z.object({ workspaceId: z.uuid(), resourceId: z.uuid() }).safeParse({
    workspaceId,
    resourceId,
  });
  if (!ids.success) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  const session = await auth?.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!issuer || !session || session.error)
    return (
      <WorkspaceShell eyebrow="REPORTS" title="Member's saved report" compact>
        <p role="alert">Your account could not be checked. Return to your account and try again.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <CustomerShell tab="results" eyebrow="REPORTS" title="Member's saved report" frame={{ back }}>
      <SavedCommercialReport
        resourceId={ids.data.resourceId}
        member={{ workspaceId: ids.data.workspaceId }}
        subject={session.data.user.id}
        issuer={issuer}
        books={await booksForPage()}
        lenses={uxSwitchOn('CORRIDRA_UX_LENSES')}
      />
    </CustomerShell>
  );
}
