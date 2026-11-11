import { TeamProblemReportForm } from '../../../../components/problem-reports/team-problem-reports';
import { readFromPage } from '../../../../lib/problem-report-client';
import { privatePageMetadata } from '../../../../lib/ux/page-metadata';
import { workspaceQuery } from '../../../../lib/ux/shells';
import { TeamProblemReportsPage } from '../team-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Report a problem');

/** The form of Report a Problem for a team member. `from` is the page they came from; only a team page is kept. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; workspace?: string }>;
}) {
  const { from: raw, workspace } = await searchParams;
  const from = readFromPage(raw, 'team');
  return (
    <TeamProblemReportsPage
      requested={workspace}
      title="Report a problem"
      filing
      signedIn={(tenant) => (
        <TeamProblemReportForm
          tenant={tenant}
          // Go Back keeps the workspace the person was in.
          from={from && { ...from, returnTo: from.returnTo + workspaceQuery(tenant) }}
        />
      )}
    />
  );
}
