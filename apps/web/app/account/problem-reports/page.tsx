import { CustomerProblemReports } from '../../../components/problem-reports/customer-problem-reports';
import { ProblemReportsPage } from './session-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your problem reports | Corridra',
  robots: { index: false, follow: false },
};

/** The person's own problem reports (ADR-078). The list is read by the browser from the customer route. */
export default function Page() {
  return (
    <ProblemReportsPage
      next="/account/problem-reports"
      title="Your problem reports"
      signedIn={(person) => <CustomerProblemReports {...person} />}
    />
  );
}
