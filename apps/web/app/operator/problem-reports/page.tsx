import { TeamProblemReports } from '../../../components/problem-reports/team-problem-reports';
import { privatePageMetadata } from '../../../lib/ux/page-metadata';
import { TeamProblemReportsPage } from './team-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Your problem reports');

/** The member's own problem reports (ADR-078). The list is read by the browser from the team route. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  return (
    <TeamProblemReportsPage
      requested={(await searchParams).workspace}
      title="Your problem reports"
      signedIn={(tenant) => <TeamProblemReports tenant={tenant} />}
    />
  );
}
