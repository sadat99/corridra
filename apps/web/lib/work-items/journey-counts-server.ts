// Server side of the sidebar's journey counts. The frame carries no server-only import (the closed-account gate and
// the header identity load their server modules the same way), so the reads are loaded when the counts are asked
// for. It never throws: with no identity, the account module off or a read that fails, the sidebar shows no counts.
import { uxSwitchOn } from '../ux-switches';
import { journeyCountsOf, type JourneyCounts } from './journey-counts';

export async function readJourneyCounts(): Promise<JourneyCounts | null> {
  try {
    const { customerIdentity } = await import('../customer-page-session');
    const identity = await customerIdentity();
    if (!identity) return null;
    const { loadWorkItems } = await import('./load');
    // `rooms` only changes a request's link, never a count; it matches the pages so they share one read.
    const list = await loadWorkItems(identity.subject, identity.issuer, {
      rooms: uxSwitchOn('CORRIDRA_UX_ROAD'),
    });
    return journeyCountsOf(list);
  } catch {
    return null;
  }
}
