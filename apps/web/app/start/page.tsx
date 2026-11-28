import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountWindow } from '../../components/account-window';
import { uxSwitchOn } from '../../lib/ux-switches';

export const metadata = {
  title: 'Start a request | Corridra',
  robots: { index: false, follow: true },
};

// The step before the request form (owner canvas board v13, 28 Nov 2026): the person chooses how to continue,
// and every choice keeps the answers. Live by default; with CORRIDRA_UX_START_V13 set to "false" the address does not
// exist, as before the page was added, and the links that led here go to /plan. Read when the page is built, so a
// change needs a redeploy.
export default function Page() {
  if (!uxSwitchOn('CORRIDRA_UX_START_V13')) notFound();
  return (
    <AccountWindow
      mode="other"
      title="How would you like to continue?"
      lead="Your answers are kept either way. You choose now, so nothing is lost."
    >
      <div className="aw-opts">
        <Link prefetch={false} className="aw-opt aw-pick" href="/signup?returnTo=%2Fplan">
          <span className="aw-ic" aria-hidden="true">
            +
          </span>
          <span>
            <b>
              Create an account <em className="aw-tag">Recommended</em>
            </b>
            Your request waits in your account. Follow replies in one place.
          </span>
        </Link>
        <Link prefetch={false} className="aw-opt" href="/signin?returnTo=%2Fplan">
          <span className="aw-ic" aria-hidden="true">
            →
          </span>
          <span>
            <b>I already have an account</b>
            Sign in first, then your request is saved to it.
          </span>
        </Link>
        <Link prefetch={false} className="aw-opt" href="/plan">
          <span className="aw-ic" aria-hidden="true">
            ↗
          </span>
          <span>
            <b>Send without an account</b>
            Start the request now and finish the account step at the end.
          </span>
        </Link>
      </div>
    </AccountWindow>
  );
}
