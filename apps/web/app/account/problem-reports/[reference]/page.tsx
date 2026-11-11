import { CustomerProblemReportDetail } from '../../../../components/problem-reports/customer-problem-reports';
import { ProblemReportsPage } from '../session-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your problem report | Corridra',
  robots: { index: false, follow: false },
};

/** One of the person's own problem reports with its history. Not theirs, or unknown: the same words. */
export default async function Page({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return (
    <ProblemReportsPage
      next={`/account/problem-reports/${encodeURIComponent(reference)}`}
      title="Your problem report"
      signedIn={(person) => <CustomerProblemReportDetail {...person} reference={reference} />}
    />
  );
}
