// Server side of Reports in a journey. It asks for the person's work list exactly as the sidebar's journey counts do
// (journey-counts-server.ts), through the same per-render cache, so the Reports page makes no read of its own. It
// never throws: with no identity or a list that cannot be read nothing is named, so every report stays visible
// and is said to be unsorted.
import { uxSwitchOn } from '../ux-switches';
import type { JourneyOfMode } from '../ux/journey-mode';
import { journeyReportScope, type JourneyReportScope } from './journey-scope';

const nothing: JourneyReportScope = { outside: [], inJourney: [] };

export async function readJourneyReportScope(mode: JourneyOfMode): Promise<JourneyReportScope> {
  try {
    const { customerIdentity } = await import('../customer-page-session');
    const identity = await customerIdentity();
    if (!identity) return nothing;
    const { loadWorkItems } = await import('./load');
    const list = await loadWorkItems(identity.subject, identity.issuer, {
      rooms: uxSwitchOn('CORRIDRA_UX_ROAD'),
    });
    return journeyReportScope(list, mode);
  } catch {
    return nothing;
  }
}
