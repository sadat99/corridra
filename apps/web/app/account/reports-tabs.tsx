import type { ReactNode } from 'react';
import { NotSortedByJourney } from '../../components/ux/journey-not-sorted';
import { SubTabs, type SubTab } from '../../components/ux/sub-tabs';

/**
 * The Reports page as three tabs on the shared sub-tabs (customer experience spec): Delivered, Saved Missions
 * and Shared With Me. The tab is kept in ?tab=. Every old address still lands: #customer-missions opens
 * Shared With Me (where the invitation lives), and #saved-commercial-missions and anything inside a panel open the tab that holds it. A tab
 * appears only when its content exists, and a single one is shown without a tab list. Nothing is removed from
 * any panel and no access is added. Members' Reports (ADR-087 U5) comes last and exists only while
 * CORRIDRA_MEMBER_ACCESS is on (decided on the server).
 */
export function ReportsTabs({
  delivered,
  saved,
  shared,
  members,
}: {
  delivered?: ReactNode;
  saved?: ReactNode;
  shared?: ReactNode;
  members?: ReactNode;
}) {
  const tabs: SubTab[] = [];
  if (delivered)
    tabs.push({
      id: 'delivered',
      label: 'Delivered',
      panel: delivered,
    });
  if (saved)
    tabs.push({
      id: 'saved',
      label: 'Saved Missions',
      // These three lists carry no request, so a chosen journey cannot sort them (journey modes 3.7): each stays
      // whole and says so. The line draws nothing in Everything or while journey modes are off.
      panel: (
        <>
          <NotSortedByJourney what="Saved missions" />
          {saved}
        </>
      ),
      aliases: ['saved-commercial-missions'],
    });
  // "My shared missions" and the invitation links point at #customer-missions, so it opens Shared With Me.
  if (shared)
    tabs.push({
      id: 'shared',
      label: 'Shared With Me',
      panel: (
        <>
          <NotSortedByJourney what="Missions shared with you" />
          {shared}
        </>
      ),
      aliases: ['customer-missions'],
    });
  if (members)
    tabs.push({
      id: 'members',
      label: "Members' Reports",
      panel: (
        <>
          <NotSortedByJourney what="Members’ reports" />
          {members}
        </>
      ),
    });
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0]!.panel}</>;
  return <SubTabs tabs={tabs} label="Reports sections" className="ux-subtabs-segmented" />;
}
