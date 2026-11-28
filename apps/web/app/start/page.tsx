import Link from 'next/link';
import { AccountWindow } from '../../components/account-window';

export const metadata = {
  title: 'Start a request | Corridra',
  robots: { index: false, follow: true },
};

// The step before the request form (owner canvas board v13, 28 Nov 2026): the person chooses how to continue,
// and every choice keeps the answers.
export default function Page() {
  return (
    <AccountWindow
      mode="other"
      title="How would you like to continue?"
      lead="Your answers are kept either way. You choose now, so nothing is lost."
    >
      <div className="aw-opts">
        <Link prefetch={false} className="aw-opt aw-pick" href="/signup?returnTo=%2Fplan">
          <span className="aw-ic" aria-hidden="true">+</span>
          <span>
            <b>
              Create an account <em className="aw-tag">Recommended</em>
            </b>
            Your request waits in your account. Follow replies in one place.
          </span>
        </Link>
        <Link prefetch={false} className="aw-opt" href="/signin?returnTo=%2Fplan">
          <span className="aw-ic" aria-hidden="true">→</span>
          <span>
            <b>I already have an account</b>
            Sign in first, then your request is saved to it.
          </span>
        </Link>
        <Link prefetch={false} className="aw-opt" href="/plan">
          <span className="aw-ic" aria-hidden="true">↗</span>
          <span>
            <b>Send without an account</b>
            Start the request now and finish the account step at the end.
          </span>
        </Link>
      </div>
    </AccountWindow>
  );
}
