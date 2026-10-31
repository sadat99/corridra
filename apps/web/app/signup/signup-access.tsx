import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { WorkspaceShell } from '../../components/workspace-shell';
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
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Create your account." compact>
      <section className="ux-account-access" aria-label="Customer account access">
        <p>Create your account to send and follow requests.</p>
        <PendingRequestNotice where="signup" />
        <p id="password-rule" className="ux-password-rule">
          Your password needs at least {passwordMinimum} characters. A short sentence you can
          remember works well.
        </p>
        {config ? (
          <>
            <Suspense fallback={<p>Loading account access…</p>}>
              <AccountForm
                mode="signup"
                returnToEmailPages={process.env.CORRIDRA_PULSE_ENABLED === 'true'}
              />
            </Suspense>
            <p>
              Your name and email are used for account access, verification and recovery. Read the{' '}
              <Link href="/privacy">
                {realUseEnabled() ? 'privacy and request notice' : 'account and request notice'}
              </Link>{' '}
              before creating an account. Team access needs a separate invitation.
            </p>
          </>
        ) : (
          <AccessState kind="unavailable">
            <p>Account access is not available yet.</p>
            <Link className="text-link" href="/plan">
              Start a request without an account
            </Link>
          </AccessState>
        )}
      </section>
    </WorkspaceShell>
  );
}
