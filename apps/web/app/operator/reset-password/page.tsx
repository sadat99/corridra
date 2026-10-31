import { operatorSignInPage } from '../../../lib/workspace-navigation';
import { Suspense } from 'react';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { operatorRecoveryMailer } from '@corridra/auth/recovery-mail';
import { OperatorRecoveryForm } from '../recovery-form';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'New operator password | Corridra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return (
    <WorkspaceShell eyebrow="OPERATOR ACCESS" title="Set a new operator password." compact>
      {!!foundations() && !!operatorRecoveryMailer() ? (
        <Suspense fallback={<p role="status">Checking reset link…</p>}>
          <OperatorRecoveryForm mode="reset" />
        </Suspense>
      ) : (
        <p role="status">
          Operator email recovery is unavailable here. Ask your workspace owner for reviewed
          recovery.
        </p>
      )}
      <a className="text-link" href={operatorSignInPage}>
        Back to operator sign-in
      </a>
    </WorkspaceShell>
  );
}
