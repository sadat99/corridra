import type { ReactNode } from 'react';
import { SubTabs, type SubTab } from '../../../components/ux/sub-tabs';

/**
 * The Meetings page as two tabs on the shared sub-tabs (layout budget, docs/revamp/specs/layout-budget.md section
 * 2): Meetings, then Your Requests. The tab is kept in ?tab=, and no tab or an unknown word opens Meetings. A tab
 * appears only when its content exists, and a single one is shown without a tab list. Nothing is removed from
 * either panel and no access is added.
 */
export function MeetingsTabs({
  meetings,
  requests,
}: {
  meetings?: ReactNode;
  requests?: ReactNode;
}) {
  const tabs: SubTab[] = [];
  if (meetings) tabs.push({ id: 'meetings', label: 'Meetings', panel: meetings });
  if (requests) tabs.push({ id: 'requests', label: 'Your Requests', panel: requests });
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0]!.panel}</>;
  return <SubTabs tabs={tabs} label="Meetings sections" className="ux-subtabs-segmented" />;
}
