import type { ReactNode } from 'react';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { customerPageSession } from '../../../lib/customer-page-session';
import { problemReportsOffered } from '../../../lib/problem-reports-offered';
import { ProblemReportsUnavailable } from '../../../components/problem-reports/unavailable';

/**
 * The frame every customer problem report page shares: the session check the account pages make, the customer frame
 * without the closed-account gate (a closed account can still read its reports and remove their words; only filing is
 * refused, by the server), and the one answer for a service that is not offered yet. `signedIn` draws the screen.
 */
export async function ProblemReportsPage({
  next,
  title,
  filing = false,
  signedIn,
}: {
  /** The path sign-in brings the person back to. */
  next: string;
  title: string;
  filing?: boolean;
  signedIn: (person: { subject: string; issuer: string }) => ReactNode;
}) {
  const session = await customerPageSession(next);
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title={title} compact>
        <p role="alert">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const offered = await problemReportsOffered();
  return (
    <CustomerShell tab="more" title={title} closedAccountReads>
      {offered ? (
        signedIn({ subject: session.subject, issuer: session.issuer })
      ) : (
        <ProblemReportsUnavailable filing={filing} />
      )}
    </CustomerShell>
  );
}
