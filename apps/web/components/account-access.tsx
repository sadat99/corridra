import { AccountWindow } from './account-window';
import { AccessState } from './access-state';
import { AccessOptions } from './access-options';
import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountForm, type AccountFormMode } from './account-form';
import { AccountAccessBefore } from './account-access-before';
import { PendingRequestNotice } from './pending-request-notice';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { accessHelp } from '../lib/access-doors';
import { emailReturnPagesOn, uxSwitchOn } from '../lib/ux-switches';
import '../app/access/access.css';

/**
 * The customer account pages: sign-in, email check and password reset. While CORRIDRA_UX_ACCESS_WINDOW_V11 is on (live
 * by default) they open in the two-pane window of the owner's canvas board v11; set to "false", they are the earlier
 * pages exactly. Without the account provider no form is drawn: the window says sign-in is not switched on here yet
 * and offers a request without an account.
 */
export function AccountAccess({ title, mode }: { title: string; mode: AccountFormMode }) {
  if (!uxSwitchOn('CORRIDRA_UX_ACCESS_WINDOW_V11'))
    return <AccountAccessBefore title={title} mode={mode} />;
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
            windowDesign
          />
        </Suspense>
      ) : mode === 'signin' ? (
        <>
          <AccessState
            kind="unavailable"
            actions={
              <Link prefetch={false} className="primary-link" href="/plan">
                Start a Request Without an Account
              </Link>
            }
          >
            <p>
              Customer sign-in is not switched on here yet. You can still start a request without an
              account. Team members sign in separately.
            </p>
          </AccessState>
          <AccessOptions {...accessHelp.signInFallback} />
        </>
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
      {config && mode === 'signin' && (
        <div className="aw-noacc">
          <span>
            <b>No account yet?</b>
            You can still send a request first and create the account after.
          </span>
          <Link
            prefetch={false}
            className="aw-ghost"
            href={uxSwitchOn('CORRIDRA_UX_START_V13') ? '/start' : '/plan'}
          >
            Start a Request
          </Link>
        </div>
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
