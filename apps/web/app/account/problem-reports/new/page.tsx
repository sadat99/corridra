import { CustomerProblemReportForm } from '../../../../components/problem-reports/customer-problem-reports';
import { readFromPage } from '../../../../lib/problem-report-client';
import { ProblemReportsPage } from '../session-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Report a problem | Corridra',
  robots: { index: false, follow: false },
};

/** The form of Report a Problem. `from` is the page the person came from; only a page of their own shell is kept. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const from = readFromPage((await searchParams).from, 'customer');
  return (
    <ProblemReportsPage
      next="/account/problem-reports/new"
      title="Report a problem"
      filing
      signedIn={(person) => <CustomerProblemReportForm {...person} from={from} />}
    />
  );
}
