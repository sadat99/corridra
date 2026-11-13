import 'server-only';
// Server side of the sidebar's journey counts. It never throws: with no identity, the account module off or a
// read that fails, the sidebar simply shows no counts.
import { customerIdentity } from '../customer-page-session';
import { uxSwitchOn } from '../ux-switches';
import { journeyCountsOf, type JourneyCounts } from './journey-counts';
import { loadWorkItems } from './load';

export async function readJourneyCounts(): Promise<JourneyCounts | null> {
  try {
    const identity = await customerIdentity();
    if (!identity) return null;
    // `rooms` only changes a request's link, never a count; it matches the pages so they share one read.
    const list = await loadWorkItems(identity.subject, identity.issuer, {
      rooms: uxSwitchOn('CORRIDRA_UX_ROAD'),
    });
    return journeyCountsOf(list);
  } catch {
    return null;
  }
}
