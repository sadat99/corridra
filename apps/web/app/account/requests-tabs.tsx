import type { ReactNode } from 'react';
import { SubTabs, type SubTab } from '../../components/ux/sub-tabs';

/**
 * The Requests page as three tabs on the shared sub-tabs (customer experience spec): Requests, Workspaces and
 * Saved. The tab is kept in ?tab=. Every old address still lands: #work-list opens Requests, and
 * #customer-workspaces and #customer-requests open the tab that holds them (the sub-tabs open the tab that
 * holds any element a #id names). A tab appears only when its content exists, and a single one is shown
 * without a tab list. Nothing is removed from any panel and no access is added.
 */
export function RequestsTabs({
  requests,
  workspaces,
  saved,
}: {
  requests?: ReactNode;
  workspaces?: ReactNode;
  saved?: ReactNode;
}) {
  const tabs: SubTab[] = [];
  if (requests)
    tabs.push({ id: 'requests', label: 'Requests', panel: requests, aliases: ['work-list'] });
  if (workspaces)
    tabs.push({
      id: 'workspaces',
      label: 'Workspaces',
      panel: workspaces,
      aliases: ['customer-workspaces'],
    });
  if (saved)
    tabs.push({ id: 'saved', label: 'Saved', panel: saved, aliases: ['customer-requests'] });
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0]!.panel}</>;
  return <SubTabs tabs={tabs} label="Requests sections" />;
}
