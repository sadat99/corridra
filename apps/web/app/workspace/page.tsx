import Link from 'next/link';
import { CorridraIcon } from '../../components/corridra-icon';
import { WorkspaceShell } from '../../components/workspace-shell';
import './workspace.css';

export const metadata = {
  title: 'Start here | Corridra',
  description: 'Plan a mission, see how it works, or sign in to your account or team workspace.',
};

// UI/UX.v4.1 L7 (owner lock, 23 November 2026): "Plan a Mission" is the only primary button. The three "Already
// working with us" doors are equal cards, each with one owned icon (L2) and its own route. Every word and link of the
// page is kept.
function Tile({ icon }: { icon: string }) {
  return (
    <span className="ux-start-tile" aria-hidden="true">
      <CorridraIcon name={icon} />
    </span>
  );
}

export default function Page() {
  return (
    <WorkspaceShell eyebrow="START HERE" title="What would you like to do?">
      <div className="ux-start">
        <section className="ux-start-grid" aria-label="Choose what to do">
          <article className="detail-card">
            <Tile icon="trip" />
            <h2>Plan a mission</h2>
            <p>
              Tell us what you want to achieve and where. It takes a few minutes. Start without an
              account. You create one at the last step to send it.
            </p>
            <Link prefetch={false} className="primary-link" href="/plan">
              Plan a Mission
            </Link>
          </article>
          <article className="detail-card">
            <Tile icon="document" />
            <h2>See how it works</h2>
            <p>Follow a sample mission from the first goal to the next step.</p>
            <Link prefetch={false} className="button-secondary" href="/corridors#mission-example">
              See a Sample Mission
            </Link>
          </article>
        </section>
        <section className="ux-start-signin" aria-labelledby="signin-title">
          <h2 id="signin-title">Already working with us?</h2>
          <details className="ux-start-signin-details">
            <summary>Already Working With Us?</summary>
            <ul>
              <li>
                <Tile icon="people" />
                <div>
                  <h3>Customer</h3>
                  <p>See your requests and missions.</p>
                </div>
                <Link prefetch={false} className="button-secondary" href="/account">
                  Open My Account
                </Link>
              </li>
              <li>
                <Tile icon="shield" />
                <div>
                  <h3>Corridra team</h3>
                  <p>
                    Team accounts are by invitation. New team member? Open your invitation email,
                    then set up your account.
                  </p>
                </div>
                <div className="ux-start-actions">
                  <Link prefetch={false} className="button-secondary" href="/operator">
                    Team Sign-In
                  </Link>
                  <Link prefetch={false} className="text-link" href="/operator/setup">
                    Set up your team account
                  </Link>
                </div>
              </li>
              <li>
                <Tile icon="network" />
                <div>
                  <h3>Supplier, programme member or local helper</h3>
                  <p>
                    Open the private link we sent you. It shows only what is shared with you. Local
                    helpers can also sign in to see their tasks.
                  </p>
                </div>
                <Link prefetch={false} className="button-secondary" href="/contributor">
                  Local Helper Sign-In
                </Link>
              </li>
            </ul>
          </details>
        </section>
        <nav className="ux-start-foot" aria-label="More">
          <Link prefetch={false} className="text-link" href="/">
            Back to Corridra
          </Link>
          <Link prefetch={false} className="text-link" href="/privacy">
            Privacy
          </Link>
        </nav>
      </div>
    </WorkspaceShell>
  );
}
