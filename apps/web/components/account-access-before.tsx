import { WorkspaceShell } from './workspace-shell';
import { AccessState } from './access-state';
import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountForm, type AccountFormMode } from './account-form';
import { PendingRequestNotice } from './pending-request-notice';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { emailReturnPagesOn } from '../lib/ux-switches';
import { AccessNotCustomer } from './access-elsewhere';
import '../app/access/access.css';
/**
 * The customer account pages as they were before the sign-in window (CORRIDRA_UX_ACCESS_WINDOW_V11 set to "false"):
 * this is main's AccountAccess, unchanged, so the switch off draws exactly the earlier pages.
 */
export function AccountAccessBefore({ title, mode }: { title: string; mode: AccountFormMode }) {
  const config = readNeonAuthConfig();
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title={title} compact>
      <section className="ux-account-access" aria-label="Customer account access">
        <p>
          {mode === 'forgot' || mode === 'reset'
            ? 'This changes your customer account password only. It does not change a team password.'
            : mode === 'signin'
              ? 'See your requests and the missions shared with you.'
              : 'Sign in to see your account and the missions shared with you.'}
        </p>
        {(mode === 'signin' || mode === 'signup' || mode === 'verify') && (
          <PendingRequestNotice where={mode} enabled={realUseEnabled()} />
        )}
        {config ? (
          <Suspense fallback={<p>Loading account access…</p>}>
            <AccountForm
              key={mode}
              mode={mode}
              codeSignIn={mode === 'signin' && process.env.CORRIDRA_CUSTOMER_CODE_SIGNIN === 'true'}
              returnToEmailPages={emailReturnPagesOn()}
            />
          </Suspense>
        ) : (
          <AccessState kind="unavailable">
            <p>Account access is not available yet.</p>
            <Link prefetch={false} className="text-link" href="/plan">
              {realUseEnabled()
                ? 'Start a Request Without an Account'
                : 'Prepare an Example Request Without an Account'}
            </Link>
          </AccessState>
        )}
        {config && mode === 'signup' && (
          <p>
            Your name and email are used for account access, verification and recovery. Read the{' '}
            <Link prefetch={false} href="/privacy">
              {realUseEnabled() ? 'privacy and request notice' : 'account and test intake notice'}
            </Link>{' '}
            before creating an account. Team access needs a separate invitation.
          </p>
        )}
        {mode === 'signin' && <AccessNotCustomer />}
      </section>
    </WorkspaceShell>
  );
}
