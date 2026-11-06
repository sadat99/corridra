import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { neonAuth } from '../../../lib/neon-auth';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { loadWorkItems } from '../../../lib/work-items/load';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Meetings | Corridra',
  robots: { index: false, follow: false },
};

// Navigation v1, the Meetings tab. The meetings and visits for a request are shown read only inside that request
// (its Room), from the report the person holds. This page lists the person's requests and opens each one where its
// meetings and visits are. One list of every meeting across requests is not built yet, and the page says so in
// plain text, not a control. It reads the same list of requests the Requests page reads, with the same session
// proof, so it shows nothing the person could not already open.
export default async function Page() {
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  const session = await auth?.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!issuer || !session || session.error)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Meetings" compact>
        <p role="alert">Your account could not be checked. Return to your account and try again.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  if (!session.data?.user) redirect(`/signin?next=${encodeURIComponent('/account/meetings')}`);
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  const list = await loadWorkItems(session.data.user.id, issuer, {
    rooms: uxSwitchOn('CORRIDRA_UX_ROAD'),
  });
  const requests = list.items.filter((item) => item.kind === 'request');
  return (
    <CustomerShell tab="meetings" eyebrow="YOUR ACCOUNT" title="Meetings">
      <p>Open a request to see its meetings and visits.</p>
      <p className="ux-soon-line">
        <span>One list of all your meetings</span> <span className="ux-soon-tag">Coming soon</span>
      </p>
      {list.unreadable.length > 0 ? (
        <p role="status">
          We could not check all your requests just now.{' '}
          <Link className="text-link" prefetch={false} href="/account/meetings">
            Try Again
          </Link>
        </p>
      ) : null}
      {requests.length === 0 && list.unreadable.length === 0 ? (
        <p role="status">
          You have no requests yet.{' '}
          <Link className="text-link" prefetch={false} href="/plan">
            Start a Request
          </Link>
        </p>
      ) : null}
      {requests.length > 0 ? (
        <ul className="ux-meeting-list">
          {requests.map((request) => (
            <li key={request.key}>
              <Link prefetch={false} className="text-link" href={request.href}>
                {request.title ?? 'Your request'}
                <span className="sr-only">: meetings and visits</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </CustomerShell>
  );
}
