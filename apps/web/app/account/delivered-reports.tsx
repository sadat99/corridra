import Link from 'next/link';
import type { CustomerDeliveredReportService } from '@corridra/auth/customer-delivered-reports';
import { EmptyState } from '../../components/ux/empty-state';
import { foundations } from '../../lib/foundations';
import { formatDate } from '../../lib/ux/format';

// CQ-77 (customer side): reports the Corridra team published for the customer's own requests, read
// through listDeliveredPublications (WS-C) behind the customer session proof. Until the service wiring
// provides it, or when there are none, nothing is shown here: the Library never invents a report.
// A read that fails is said plainly (revamp Wave 1): hiding it would look like "no reports".
export async function DeliveredReports({
  subject,
  issuer,
  showEmpty = false,
}: {
  subject: string;
  issuer: string;
  /** The Delivered tab holds nothing else, so an empty list says so instead of leaving the tab blank. */
  showEmpty?: boolean;
}) {
  const none = showEmpty ? (
    <EmptyState icon="inbox">No reports have been delivered to you yet.</EmptyState>
  ) : null;
  const s = foundations();
  const service = (s as unknown as { customerDeliveredReports?: CustomerDeliveredReportService })
    ?.customerDeliveredReports;
  if (!s || !service) return none;
  let reports: Awaited<ReturnType<CustomerDeliveredReportService['list']>>;
  try {
    await s.ready;
    reports = await service.list(subject, issuer);
  } catch {
    return (
      <section className="detail-card" aria-labelledby="delivered-reports-heading" lang="en">
        <h2 id="delivered-reports-heading">Reports for your requests</h2>
        <p role="status">
          Your reports could not be loaded just now. Nothing was lost. Refresh this page to try
          again.
        </p>
      </section>
    );
  }
  if (reports.length === 0) return none;
  return (
    <section className="detail-card" aria-labelledby="delivered-reports-heading">
      <h2 id="delivered-reports-heading">Reports for your requests</h2>
      <ul className="ux-link-list">
        {reports.map((report) => (
          <li key={report.id}>
            <Link prefetch={false} href={report.href}>
              <strong>{report.title}</strong>
              {report.publishedAt ? <span>Published {formatDate(report.publishedAt)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
