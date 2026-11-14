import { AccessOptions } from '../../../components/access-options';
import { accessHelp } from '../../../lib/access-doors';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { SetupForm } from '../../operator/setup/setup-form';
export const metadata = {
  title: 'Invited contributor setup | Corridra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return (
    <WorkspaceShell
      eyebrow="INVITED CONTRIBUTOR ACCESS"
      title="Set up your contributor access."
      compact
    >
      <p>
        First, sign in to your verified customer account. Use the email your workspace owner
        invited. Next, set your separate contributor password. Then enroll your authenticator. A
        customer account alone does not grant task access.
      </p>
      <p id="contributor-password-rule">
        <strong>Password rule:</strong> at least 14 characters and at most 128. Use a password you
        do not use anywhere else, including your customer account.
      </p>
      <SetupForm kind="contributor" />
      <AccessOptions {...accessHelp.contributorSetup} />
    </WorkspaceShell>
  );
}
