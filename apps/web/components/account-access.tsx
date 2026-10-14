import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountForm, type AccountFormMode } from './account-form';
export function AccountAccess({ title, mode }: { title: string; mode: AccountFormMode }) {
  const config = readNeonAuthConfig();
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero status-page">
        <p className="label">YOUR ACCOUNT</p>
        <h1>{title}</h1>
        {config ? (
          <Suspense fallback={<p>Loading account access…</p>}>
            <AccountForm mode={mode} />
          </Suspense>
        ) : (
          <p>Account access is not available yet.</p>
        )}
        {config && mode === 'signup' && (
          <p>
            Your name and email are used for account access, verification and recovery. Read the{' '}
            <Link href="/privacy">account and test intake notice</Link> before creating an account.
            Workspace access requires a separate invitation.
          </p>
        )}
        {mode === 'signin' && (
          <nav className="access-options" aria-label="Other access routes">
            <h2>Invited workspace access</h2>
            <p>
              Operators use their workspace invitation. Local contributors use the assigned-task
              link supplied with their invitation. Institution and client sharing links keep their
              existing access scope.
            </p>
            <Link className="text-link" href="/operator">
              Operator workspace
            </Link>
            <Link className="text-link" href="/workspace">
              Explore all workspaces and tools
            </Link>
            <Link className="text-link" href="/contributor">
              Assigned-task access
            </Link>
            <Link className="text-link" href="/plan">
              Start a test mission brief
            </Link>
          </nav>
        )}
      </section>
    </main>
  );
}
