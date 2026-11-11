'use client';
import { useMemo, useState } from 'react';
import type { FromPage, ReportTarget } from '../../lib/problem-report-client';
import { customerReportLinks } from '../../lib/problem-report-links';
import { sessionHeaders } from '../../app/account/workspace-lifecycle-client';
import { ProblemReportDetailView } from './problem-report-detail';
import { ProblemReportForm } from './problem-report-form';
import { ProblemReportList } from './problem-report-list';
import { RemoveMyWords } from './remove-my-words';

// The customer's three screens. Each is told only who the page was drawn for: a function cannot cross from the server
// page to the browser, so the addresses are read here, from the customer's own set (never the team's).
function useCustomerTarget(subject: string, issuer: string) {
  const headers = useMemo(() => sessionHeaders(subject, issuer), [subject, issuer]);
  const target = useMemo<ReportTarget>(() => ({ side: 'customer', headers }), [headers]);
  return { headers, target };
}

export function CustomerProblemReportForm({
  subject,
  issuer,
  from,
}: {
  subject: string;
  issuer: string;
  from: FromPage | null;
}) {
  const { target } = useCustomerTarget(subject, issuer);
  return <ProblemReportForm target={target} links={customerReportLinks} from={from} />;
}

/** The list page: their reports, then the way to remove the words of all of them. */
export function CustomerProblemReports({ subject, issuer }: { subject: string; issuer: string }) {
  const { headers, target } = useCustomerTarget(subject, issuer);
  const [reload, setReload] = useState(0);
  return (
    <>
      <ProblemReportList target={target} links={customerReportLinks} reload={reload} />
      <RemoveMyWords
        headers={headers}
        links={customerReportLinks}
        onRemoved={() => setReload((count) => count + 1)}
      />
    </>
  );
}

export function CustomerProblemReportDetail({
  subject,
  issuer,
  reference,
}: {
  subject: string;
  issuer: string;
  reference: string;
}) {
  const { target } = useCustomerTarget(subject, issuer);
  return (
    <ProblemReportDetailView target={target} links={customerReportLinks} reference={reference} />
  );
}
