import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { emailReturnPagesOn } from '../../lib/ux-switches';
import { AccountWindow } from '../../components/account-window';
import { AccessState } from '../../components/access-state';
import { AccountForm } from '../../components/account-form';
import { PendingRequestNotice } from '../../components/pending-request-notice';

/** The password rule the account provider enforces for a new customer account (the form's minimum). */
export const passwordMinimum = 14;

/**
 * The create-account page (CQ-38). Same form, notice and privacy line as the shared account access block,
 * with a subtitle that says what the page is for and the password rule shown before anyone submits.
 */
export function SignupAccess() {
  const config = readNeonAuthConfig();
  return (
    <AccountWindow
      mode="signup"
      title="Create your account."
      lead="To send and follow requests. Your request will be waiting here."
      extended={emailReturnPagesOn()}
    >
      <PendingRequestNotice where="signup" enabled={realUseEnabled()} />
      {config ? (
        <>
          <Suspense fallback={<p>Loading account access…</p>}>
            <AccountForm mode="signup" returnToEmailPages={emailReturnPagesOn()} />
          </Suspense>
          <p id="password-rule" className="ux-password-rule">
            Your password needs at least {passwordMinimum} characters. A short sentence you can
            remember works well. Your name and email are used for account access, verification and
            recovery. Read the{' '}
            <Link prefetch={false} href="/privacy">
              {realUseEnabled() ? 'privacy and request notice' : 'account and request notice'}
            </Link>
            .
          </p>
        </>
      ) : (
        <AccessState kind="unavailable">
          <p>Account access is not available yet.</p>
          <Link prefetch={false} className="text-link" href="/plan">
            Start a Request Without an Account
          </Link>
        </AccessState>
      )}
    </AccountWindow>
  );
}
