import Link from 'next/link';
import { operatorSignInPage } from '../../../lib/workspace-navigation';
import { Suspense } from 'react';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { operatorRecoveryMailer } from '@corridra/auth/recovery-mail';
import { OperatorRecoveryForm } from '../recovery-form';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Recover operator access | Corridra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  const available = !!foundations() && !!operatorRecoveryMailer();
  return (
    <WorkspaceShell eyebrow="OPERATOR ACCESS" title="Reset your operator password." compact>
      <p>
        This resets an existing operator password. Your authenticator is still required. It does not
        change your customer account password or grant a workspace role.
      </p>
      {available ? (
        <Suspense fallback={<p role="status">Loading recovery…</p>}>
          <OperatorRecoveryForm mode="request" />
        </Suspense>
      ) : (
        <p role="status">
          Operator email recovery is unavailable here. This page does not collect credentials. Ask
          your workspace owner for reviewed recovery.
        </p>
      )}
      <nav className="access-options" aria-label="Recovery options">
        <Link className="text-link" href="/operator/setup">
          Finish a pending invitation
        </Link>
        <a className="text-link" href={operatorSignInPage}>
          Back to operator sign-in
        </a>
        <Link className="text-link" href="/forgot-password">
          Reset a customer account password
        </Link>
      </nav>
    </WorkspaceShell>
  );
}
