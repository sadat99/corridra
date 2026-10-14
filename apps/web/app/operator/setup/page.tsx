import Link from 'next/link';
import { SetupForm } from './setup-form';
export const metadata = {
  title: 'Invited operator setup | Corridra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">INVITED OPERATOR ACCESS</p>
      <h1>Set up your operator access.</h1>
      <p>
        Sign in to your verified customer account first. A workspace owner must explicitly invite
        that email. This step creates your separate operator password; it does not turn customer
        signups into administrators.
      </p>
      <SetupForm />
      <nav className="access-options" aria-label="Operator setup help">
        <Link className="text-link" href="/account">
          Customer account and email verification
        </Link>
        <Link className="text-link" href="/operator/signin">
          Operator sign-in and authenticator
        </Link>
        <Link className="text-link" href="/workspace">
          All workspaces and tools
        </Link>
      </nav>
    </main>
  );
}
