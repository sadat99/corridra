import { AccountWindow } from './account-window';
import { AccessState } from './access-state';
import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountForm, type AccountFormMode } from './account-form';
import { PendingRequestNotice } from './pending-request-notice';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { emailReturnPagesOn } from '../lib/ux-switches';
import '../app/access/access.css';
export function AccountAccess({ title, mode }: { title: string; mode: AccountFormMode }) {
  const config = readNeonAuthConfig();
  const lead =
    mode === 'forgot' || mode === 'reset'
      ? 'This changes your customer account password only. It does not change a team password.'
      : mode === 'signin'
        ? 'See your requests and the missions shared with you.'
        : 'Sign in to see your account and the missions shared with you.';
  return (
    <AccountWindow
      mode={mode === 'signin' || mode === 'signup' ? mode : 'other'}
      title={title}
      lead={lead}
      extended={emailReturnPagesOn()}
    >
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
          before creating an account.
        </p>
      )}
    </AccountWindow>
  );
}
