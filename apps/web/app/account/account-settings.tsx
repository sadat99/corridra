import type { ReactNode } from 'react';
import { SubTabs, type SubTab } from '../../components/ux/sub-tabs';

/**
 * The Account page as a settings layout on the shared sub-tabs (customer experience spec): Profile, Workspaces
 * and Team, Notifications, Plan and Billing, and Security. The tab is kept in ?tab=. A tab appears only when
 * its area is on, and a single one is shown without a tab list. Nothing is removed and no access is added.
 */
export function AccountSettings({
  profile,
  workspaces,
  notifications,
  billing,
  security,
}: {
  profile?: ReactNode;
  workspaces?: ReactNode;
  notifications?: ReactNode;
  billing?: ReactNode;
  security?: ReactNode;
}) {
  const tabs: SubTab[] = [];
  if (profile) tabs.push({ id: 'profile', label: 'Profile', panel: profile });
  if (workspaces) tabs.push({ id: 'workspaces', label: 'Workspaces and Team', panel: workspaces });
  if (notifications)
    tabs.push({ id: 'notifications', label: 'Notifications', panel: notifications });
  if (billing) tabs.push({ id: 'billing', label: 'Plan and Billing', panel: billing });
  if (security) tabs.push({ id: 'security', label: 'Security', panel: security });
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div className="ux-account-tabs">{tabs[0]!.panel}</div>;
  return <SubTabs tabs={tabs} label="Account sections" className="ux-account-tabs" />;
}
