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
            ? 'This changes your customer account password. It does not change an operator password or authenticator.'
            : 'Use your customer account to manage your profile and open missions explicitly shared with you.'}
        </p>
        {config ? (
          <Suspense fallback={<p>Loading account access…</p>}>
            <AccountForm mode={mode} />
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
            Workspace access requires a separate invitation.
          </p>
        )}
        {mode === 'signin' && (
          <details className="ux-journey-disclosure">
            <summary>Looking for an operator workspace or invitation?</summary>
            <nav className="access-options" aria-label="Other access routes">
              <h2>Open existing work</h2>
              <p>
                Operators use their separate operator password and authenticator. For a shared
                mission, programme or assigned task, use the original private link you received.
              </p>
              <Link className="text-link" href="/operator">
                Operator workspace
              </Link>
              <Link className="text-link" href="/workspace">
                Help me find the right entry
              </Link>
              <Link className="text-link" href="/contributor">
                Assigned-task access
              </Link>
              <Link className="text-link" href="/plan">
                Start a test mission request
              </Link>
            </nav>
          </details>
        )}
      </section>
    </WorkspaceShell>
  );
}
