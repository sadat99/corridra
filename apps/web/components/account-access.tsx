import { WorkspaceShell } from './workspace-shell';
import { AccessState } from './access-state';
import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountForm, type AccountFormMode } from './account-form';
export function AccountAccess({ title, mode }: { title: string; mode: AccountFormMode }) {
  const config = readNeonAuthConfig();
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title={title} compact>
      <section className="ux-account-access" aria-label="Customer account access">
        <p>
          {mode === 'forgot' || mode === 'reset'
            ? 'This changes your customer account password only. It does not change a team password.'
            : 'Sign in to see your account and the missions shared with you.'}
        </p>
        {config ? (
          <Suspense fallback={<p>Loading account access…</p>}>
            <AccountForm key={mode} mode={mode} />
          </Suspense>
        ) : (
          <AccessState kind="unavailable">
            <p>Account access is not available yet.</p>
            <Link className="text-link" href="/plan">
              Prepare an example request without an account
            </Link>
          </AccessState>
        )}
        {config && mode === 'signup' && (
          <p>
            Your name and email are used for account access, verification and recovery. Read the{' '}
            <Link href="/privacy">account and test intake notice</Link> before creating an account.
            Team access needs a separate invitation.
          </p>
        )}
        {mode === 'signin' && (
          <details className="ux-journey-disclosure">
            <summary>Not a customer?</summary>
            <nav className="access-options" aria-label="Other access routes">
              <p>
                Team members sign in separately. For a shared mission, programme or task, use the
                private link we sent you.
              </p>
              <Link className="text-link" href="/operator">
                Team sign-in
              </Link>
              <Link className="text-link" href="/workspace">
                Start page
              </Link>
              <Link className="text-link" href="/contributor">
                Local helper tasks
              </Link>
              <Link className="text-link" href="/plan">
                Plan a mission
              </Link>
            </nav>
          </details>
        )}
      </section>
    </WorkspaceShell>
  );
}
