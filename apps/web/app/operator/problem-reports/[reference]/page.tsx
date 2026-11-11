import { TeamProblemReportDetail } from '../../../../components/problem-reports/team-problem-reports';
import { privatePageMetadata } from '../../../../lib/ux/page-metadata';
import { TeamProblemReportsPage } from '../team-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Your problem report');

/** One of the member's own problem reports with its history. Not theirs, or unknown: the same words. */
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<{ workspace?: string }>;
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  return (
    <TeamProblemReportsPage
      requested={(await searchParams).workspace}
      title="Your problem report"
      signedIn={(tenant) => <TeamProblemReportDetail tenant={tenant} reference={reference} />}
    />
  );
}
