'use client';
import { useMemo } from 'react';
import type { FromPage, ReportTarget } from '../../lib/problem-report-client';
import { teamReportLinks } from '../../lib/problem-report-links';
import { ProblemReportDetailView } from './problem-report-detail';
import { ProblemReportForm } from './problem-report-form';
import { ProblemReportList } from './problem-report-list';

// The team's three screens: the same components as the customer's, told they are drawn for a team member of the chosen
// workspace. The addresses come from the team's own set (never /account), and the routes read the operator session.
function useTeamTarget(tenant: string) {
  const target = useMemo<ReportTarget>(() => ({ side: 'team', tenant }), [tenant]);
  const links = useMemo(() => teamReportLinks(tenant), [tenant]);
  return { target, links };
}

export function TeamProblemReportForm({ tenant, from }: { tenant: string; from: FromPage | null }) {
  const { target, links } = useTeamTarget(tenant);
  return <ProblemReportForm target={target} links={links} from={from} />;
}

/** The member's own problem reports. Triage is the workspace's panel, not this page. */
export function TeamProblemReports({ tenant }: { tenant: string }) {
  const { target, links } = useTeamTarget(tenant);
  return <ProblemReportList target={target} links={links} />;
}

export function TeamProblemReportDetail({
  tenant,
  reference,
}: {
  tenant: string;
  reference: string;
}) {
  const { target, links } = useTeamTarget(tenant);
  return <ProblemReportDetailView target={target} links={links} reference={reference} />;
}
