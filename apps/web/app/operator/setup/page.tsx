import { AccessOptions } from '../../../components/access-options';
import { accessHelp } from '../../../lib/access-doors';
import { operatorSignInPage } from '../../../lib/workspace-navigation';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { SetupForm } from './setup-form';
export const metadata = {
  title: 'Invited operator setup | Corridra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return (
    <WorkspaceShell eyebrow="INVITED OPERATOR ACCESS" title="Set up your operator access." compact>
      <p>
        Sign in to your verified customer account first. A workspace owner must explicitly invite
        that email. This step creates your separate operator password; it does not turn customer
        signups into administrators.
      </p>
      <SetupForm />
      <AccessOptions {...accessHelp.operatorSetup(operatorSignInPage)} />
    </WorkspaceShell>
  );
}
