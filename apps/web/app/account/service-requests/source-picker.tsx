import Link from 'next/link';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { foundations } from '../../../lib/foundations';
import { formatDate } from '../../../lib/ux/format';
import { requestTitle } from '../request-words';

// CQ-27: /account/service-requests/new without a source asks what the help is for, instead of a
// plain "not found". Every option opens the existing request-help form with a real source the
// signed-in customer can already read; nothing here creates a request.
type Row = { id: string; createdAt: string; title: string | null };

async function ownRequests(subject: string, issuer: string): Promise<Row[] | null> {
  if (!customerRequestsEnabled()) return null;
  const s = foundations();
  if (!s) return null;
  try {
    await s.ready;
    const page = (await s.customerRequests.list({ pageSize: 20 }, subject, issuer)) as {
      requests: { id: string; createdAt: string; available: boolean }[];
    };
    return await Promise.all(
      page.requests
        .filter((row) => row.available)
        .map(async (row) => {
          let title: string | null = null;
          if (customerRequestDetailsEnabled())
            try {
              const detail = (await s.customerRequestDetails.detail(row.id, subject, issuer)) as {
                original?: unknown;
              } | null;
              title = requestTitle(detail?.original);
            } catch {
              title = null;
            }
          return { id: row.id, createdAt: row.createdAt, title };
        }),
    );
  } catch {
    return null;
  }
}

export async function ServiceRequestSourcePicker({
  subject,
  issuer,
}: {
  subject: string;
  issuer: string;
}) {
  const requests = await ownRequests(subject, issuer);
  return (
    <section className="detail-card" aria-labelledby="help-source-heading">
      <h2 id="help-source-heading">What is this help for?</h2>
      <p>
        Choose what the Corridra team should help with. You can add the details on the next page.
      </p>
      {requests === null ? (
        <p role="status">Your requests could not be listed right now. Try again in a moment.</p>
      ) : requests.length === 0 ? (
        <p className="ux-empty">You have not sent a request yet.</p>
      ) : (
        <>
          <h3>One of your requests</h3>
          <ul className="ux-link-list">
            {requests.map((row) => (
              <li key={row.id}>
                <Link
                  prefetch={false}
                  href={'/account/service-requests/new?kind=request&ref=' + row.id}
                >
                  <strong>{row.title ?? 'Request'}</strong>
                  <span>Sent {formatDate(row.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Something else</h3>
      <ul className="ux-link-list">
        {customerProgrammesEnabled() && (
          <li>
            <Link prefetch={false} href="/account/delegations/organise">
              <strong>A programme</strong>
              <span>Open Programmes, then choose “Request help with this programme”.</span>
            </Link>
          </li>
        )}
        {customerCompaniesEnabled() && (
          <li>
            <Link prefetch={false} href="/account/companies">
              <strong>An approved company</strong>
              <span>Open Companies, then choose “Request help with this company”.</span>
            </Link>
          </li>
        )}
        <li>
          <Link prefetch={false} href="/account?view=work">
            <strong>A new request</strong>
            <span>Start a new request first; you can ask for help on it once it is sent.</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
