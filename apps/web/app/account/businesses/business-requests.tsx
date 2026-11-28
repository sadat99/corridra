import Link from 'next/link';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { foundations } from '../../../lib/foundations';

/**
 * Requests on My Businesses (customer account v18): for each business the server says this person belongs to, a
 * link that starts a request for it, and a link to the person's own requests. The list of businesses is read on the
 * server for this person, never taken from the browser or the Acting for choice, and /account/request/<id> checks
 * the membership again before anything is sent. A request belongs to the person who sent it inside one business;
 * a list the whole team shares has no server yet, so the page keeps that row Coming soon. No count is shown.
 */
export async function BusinessRequests({ subject, issuer }: { subject: string; issuer: string }) {
  // A closed gate reads nothing: no provider state, no optional schema, no private data.
  if (!customerRequestsEnabled() || !customerWorkspacesEnabled()) return null;
  const services = foundations();
  if (!services) return null;
  let businesses: { id: string; name: string; archived: boolean }[];
  try {
    await services.ready;
    // The same two fresh proofs the request page uses: request admission, then the person's current businesses.
    await services.customerRequests.list({ pageSize: 1 }, subject, issuer);
    businesses = (await services.customerWorkspaces.list(subject, issuer)).map((business) => ({
      id: business.id,
      // CQ-56: a made-up example business says so in a live account, as the workspace list does.
      name:
        realCustomerInput() && business.synthetic && !business.name.includes('(madeup)')
          ? business.name + ' (madeup)'
          : business.name,
      archived: business.archived,
    }));
  } catch {
    return (
      <p role="status">
        Requests for your businesses could not be confirmed. Reload the page to try again.
      </p>
    );
  }
  if (businesses.length === 0) return null;
  return (
    <section className="ux-rows guide-area" aria-labelledby="business-requests-title">
      <h2 id="business-requests-title">Requests</h2>
      <ul>
        {businesses.map((business) => (
          <li key={business.id} className="ux-row">
            {business.archived ? (
              <div className="ux-row-link" aria-disabled="true">
                <span className="ux-row-title">{business.name}</span>
                <span className="ux-row-cell">Restore this business to start a request.</span>
                <span className="ux-badge">Archived</span>
              </div>
            ) : (
              <Link
                prefetch={false}
                className="ux-row-link"
                href={'/account/request/' + business.id}
              >
                <span className="ux-row-title">{business.name}</span>
                <span className="ux-row-cell">Send a new request for this business.</span>
                <span className="ux-row-cell">Start a Request</span>
              </Link>
            )}
          </li>
        ))}
        <li className="ux-row">
          <Link prefetch={false} className="ux-row-link" href="/account?view=work">
            <span className="ux-row-title">My Requests</span>
            <span className="ux-row-cell">Every request you have sent, for each business.</span>
            <span className="ux-row-cell">Open My Work</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
