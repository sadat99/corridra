import type { ReactNode } from 'react';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { CustomerNav, type CustomerTab } from './customer-nav';
import { WorkspaceShell } from './workspace-shell';

/** The signed-in customer frame: page heading plus the locked customer navigation. Server only. */
export function CustomerShell({
  tab,
  eyebrow,
  title,
  children,
}: {
  tab: CustomerTab;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceShell
      eyebrow={eyebrow}
      title={title}
      nav={<CustomerNav current={tab} companies={customerCompaniesEnabled()} />}
    >
      {children}
    </WorkspaceShell>
  );
}
