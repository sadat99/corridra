import type { ReactNode } from 'react';
import { CustomerProblemReportsFlag } from '../../components/ux/problem-reports-flag';
import { problemReportsOffered } from '../../lib/problem-reports-offered';

/**
 * Every customer page carries one flag for the header: whether Report a Problem is offered. The probe is cached (a minute
 * while the module is missing, for good once it is there) and a failed read is "not offered", so the Help menu says
 * Coming soon and nothing else about a page changes.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CustomerProblemReportsFlag offered={await problemReportsOffered()} />
      {children}
    </>
  );
}
