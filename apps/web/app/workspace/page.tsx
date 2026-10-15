import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';

export const metadata = {
  title: 'Start here | Corridra',
  description: 'Plan a mission, see how it works, or sign in to your account or team workspace.',
};

export default function Page() {
  return (
    <WorkspaceShell eyebrow="START HERE" title="What would you like to do?">
      <div className="ux-start">
        <section className="ux-start-grid" aria-label="Choose what to do">
          <article className="detail-card">
            <h2>Plan a mission</h2>
            <p>
              Tell us what you want to achieve and where. It takes a few minutes and needs no
              account.
            </p>
            <Link className="primary-link" href="/plan">
              Plan a mission
            </Link>
          </article>
          <article className="detail-card">
            <h2>See how it works</h2>
            <p>Follow a sample mission from the first goal to the next step.</p>
            <Link className="button-secondary" href="/#mission-example">
              See a sample mission
            </Link>
          </article>
        </section>
        <section className="ux-start-signin" aria-labelledby="signin-title">
          <h2 id="signin-title">Already working with us?</h2>
          <ul>
            <li>
              <div>
                <h3>Customer</h3>
                <p>See your requests and missions.</p>
              </div>
              <Link className="primary-link" href="/account">
                Open my account
              </Link>
            </li>
            <li>
              <div>
                <h3>Corridra team</h3>
                <p>
                  Team accounts are by invitation. New team member? Open your invitation email, then
                  set up your account.
                </p>
              </div>
              <div className="ux-start-actions">
                <Link className="primary-link" href="/operator">
                  Team sign-in
                </Link>
                <Link className="text-link" href="/operator/setup">
                  Set up your team account
                </Link>
              </div>
            </li>
            <li>
              <div>
                <h3>Supplier, programme member or local helper</h3>
                <p>
                  Open the private link we sent you. It shows only what is shared with you. Local
                  helpers can also sign in to see their tasks.
                </p>
              </div>
              <Link className="text-link" href="/contributor">
                Local helper sign-in
              </Link>
            </li>
          </ul>
        </section>
        <nav className="ux-start-foot" aria-label="More">
          <Link className="text-link" href="/">
            Back to Corridra
          </Link>
          <Link className="text-link" href="/privacy">
            Privacy
          </Link>
        </nav>
      </div>
    </WorkspaceShell>
  );
}
