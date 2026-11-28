import { AccountWindow } from './account-window';
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
        <form className="operator-form" aria-describedby="aw-off">
          <label className="field">
            Email
            <input type="email" disabled placeholder="name@company.com" />
          </label>
          <button className="primary-link" type="button" disabled>
            Continue
          </button>
          <p id="aw-off" className="aw-off">
            Customer sign-in is not switched on here yet. You can still send a request.
          </p>
        </form>
      )}
      {mode === 'signin' && (
        <div className="aw-noacc">
          <span>
            <b>No account yet?</b>
            You can still send a request first and create the account after.
          </span>
          <Link prefetch={false} className="aw-ghost" href="/start">
            Start a request
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
