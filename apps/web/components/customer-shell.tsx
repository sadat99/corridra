import { realUseEnabled } from '@corridra/auth/customer-production';
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
      notice={
        <p className="ux-testmode" role="note">
          {realUseEnabled() ? (
            <>Your work stays private to the people given access.</>
          ) : (
            <>
              <strong>Test mode:</strong> invented data only. Use made-up names and details.
            </>
          )}
        </p>
      }
      nav={<CustomerNav current={tab} companies={customerCompaniesEnabled()} />}
    >
      {children}
    </WorkspaceShell>
  );
}
