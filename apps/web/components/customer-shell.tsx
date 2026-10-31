import { realUseEnabled } from '@corridra/auth/customer-production';
import type { ReactNode } from 'react';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { uxSwitchOn } from '../lib/ux-switches';
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
              <strong>Preview workspace:</strong> use made-up names and details here.
            </>
          )}
        </p>
      }
      nav={
        <CustomerNav
          current={tab}
          companies={customerCompaniesEnabled()}
          plainNames={uxSwitchOn('CORRIDRA_UX_NAV')}
          move={uxSwitchOn('CORRIDRA_UX_MOVE')}
          translated={uxSwitchOn('CORRIDRA_UX_SHELLS_V2')}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
