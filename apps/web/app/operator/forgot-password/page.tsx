import { AccessOptions } from '../../../components/access-options';
import { accessHelp } from '../../../lib/access-doors';
import { operatorSignInPage } from '../../../lib/workspace-navigation';
import { Suspense } from 'react';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { operatorRecoveryMailer } from '@corridra/auth/recovery-mail';
import { OperatorRecoveryForm } from '../recovery-form';
export const dynamic = 'force-dynamic';
type Search = Promise<{ for?: string }>;
/** The helper sign-in links here with ?for=helper. Any other value is the operator page, as before. */
const fromHelper = async (searchParams: Search) => (await searchParams).for === 'helper';
export async function generateMetadata({ searchParams }: { searchParams: Search }) {
  return {
    title: (await fromHelper(searchParams))
      ? 'Recover your work password | Corridra'
      : 'Recover operator access | Corridra',
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
  };
}
export default async function Page({ searchParams }: { searchParams: Search }) {
  const helper = await fromHelper(searchParams);
  const available = !!foundations() && !!operatorRecoveryMailer();
  return (
    <WorkspaceShell
      eyebrow={helper ? 'Assigned work' : 'OPERATOR ACCESS'}
      title={helper ? 'Reset your work password.' : 'Reset your operator password.'}
      compact
    >
      <p>
        {helper
          ? 'This resets the password of your existing work account. Your authenticator is still required. It does not change your customer account password or give you access to a task.'
          : 'This resets an existing operator password. Your authenticator is still required. It does not change your customer account password or grant a workspace role.'}
      </p>
      {available ? (
        <Suspense fallback={<p role="status">Loading recovery…</p>}>
          <OperatorRecoveryForm mode="request" helper={helper} />
        </Suspense>
      ) : (
        <p role="status">
          {helper
            ? 'Work account email recovery is unavailable here. This page does not collect credentials. Ask the person who invited you for reviewed recovery.'
            : 'Operator email recovery is unavailable here. This page does not collect credentials. Ask your workspace owner for reviewed recovery.'}
        </p>
      )}
      <AccessOptions
        {...(helper
          ? accessHelp.helperForgotPassword
          : accessHelp.operatorForgotPassword(operatorSignInPage))}
      />
    </WorkspaceShell>
  );
}
