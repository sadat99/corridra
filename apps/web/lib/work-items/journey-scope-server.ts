// Server side of Reports in a journey. It asks for the person's work list exactly as the sidebar's journey counts do
// (journey-counts-server.ts), through the same per-render cache, so the Reports page makes no read of its own. It
// never throws: with no identity or a list that cannot be read nothing is named, so every report stays visible.
import { uxSwitchOn } from '../ux-switches';
import type { JourneyOfMode } from '../ux/journey-mode';
import { requestsOutsideJourney } from './journey-scope';

export async function readRequestsOutsideJourney(mode: JourneyOfMode): Promise<string[]> {
  try {
    const { customerIdentity } = await import('../customer-page-session');
    const identity = await customerIdentity();
    if (!identity) return [];
    const { loadWorkItems } = await import('./load');
    const list = await loadWorkItems(identity.subject, identity.issuer, {
      rooms: uxSwitchOn('CORRIDRA_UX_ROAD'),
    });
    return requestsOutsideJourney(list, mode);
  } catch {
    return [];
  }
}
