import Link from 'next/link';
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
        Sign in to your verified customer account first, using the email your workspace owner
        invited. Then set your separate contributor password and enroll your authenticator. A
        customer account alone does not grant task access.
      </p>
      <p id="contributor-password-rule">
        <strong>Password rule:</strong> at least 14 characters and at most 128. Use a password you
        do not use anywhere else, including your customer account.
      </p>
      <SetupForm kind="contributor" />
      <nav className="access-options" aria-label="Contributor setup help">
        <Link className="text-link" href="/account">
          Account and email verification
        </Link>
        <Link className="text-link" href="/contributor">
          Assigned-task access help
        </Link>
        <Link className="text-link" href="/network">
          About Corridra Network
        </Link>
      </nav>
    </WorkspaceShell>
  );
}
