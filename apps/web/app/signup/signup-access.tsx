import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { emailReturnPagesOn, uxSwitchOn } from '../../lib/ux-switches';
import { WorkspaceShell } from '../../components/workspace-shell';
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
  if (!uxSwitchOn('CORRIDRA_UX_ACCESS_WINDOW_V11')) return <SignupAccessBefore />;
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
            <AccountForm mode="signup" returnToEmailPages={emailReturnPagesOn()} windowDesign />
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

/** The create-account page as it was before the window (CORRIDRA_UX_ACCESS_WINDOW_V11 set to "false"), unchanged. */
function SignupAccessBefore() {
  const config = readNeonAuthConfig();
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Create your account." compact>
      <section className="ux-account-access" aria-label="Customer account access">
        <p>Create your account to send and follow requests.</p>
        <PendingRequestNotice where="signup" enabled={realUseEnabled()} />
        <p id="password-rule" className="ux-password-rule">
          Your password needs at least {passwordMinimum} characters. A short sentence you can
          remember works well.
        </p>
        {config ? (
          <>
            <Suspense fallback={<p>Loading account access…</p>}>
              <AccountForm mode="signup" returnToEmailPages={emailReturnPagesOn()} />
            </Suspense>
            <p>
              Your name and email are used for account access, verification and recovery. Read the{' '}
              <Link prefetch={false} href="/privacy">
                {realUseEnabled() ? 'privacy and request notice' : 'account and request notice'}
              </Link>{' '}
              before creating an account. Team access needs a separate invitation.
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
      </section>
    </WorkspaceShell>
  );
}
