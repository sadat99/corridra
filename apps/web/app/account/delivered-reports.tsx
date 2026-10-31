import Link from 'next/link';
import type { CustomerDeliveredReportService } from '@corridra/auth/customer-delivered-reports';
import { foundations } from '../../lib/foundations';
import { formatDate } from '../../lib/ux/format';

// CQ-77 (customer side): reports the Corridra team published for the customer's own requests, read
// through listDeliveredPublications (WS-C) behind the customer session proof. Until the service wiring
// provides it, or when there are none, nothing is shown here: the Library never invents a report.
export async function DeliveredReports({ subject, issuer }: { subject: string; issuer: string }) {
  const s = foundations();
  const service = (s as unknown as { customerDeliveredReports?: CustomerDeliveredReportService })
    ?.customerDeliveredReports;
  if (!s || !service) return null;
  let reports: Awaited<ReturnType<CustomerDeliveredReportService['list']>>;
  try {
    await s.ready;
    reports = await service.list(subject, issuer);
  } catch {
    return null;
  }
  if (reports.length === 0) return null;
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
