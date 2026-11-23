// The short reference of one request (RQ-000001) for the request's own page. Journey modes only: the sidebar there
// already reads the person's work list for its counts, and this asks for the same list through the same per-render
// cache, so the page makes no extra read. It never throws and it answers only from the person's own list: off, an
// unread list, a request beyond the pages read or a reference module that is not installed all give nothing.
import { journeyModesOn, uxSwitchOn } from '../ux-switches';

const shape = /^RQ-\d{1,12}$/;

export async function requestReference(
  subject: string,
  issuer: string,
  requestId: string,
): Promise<string | undefined> {
  if (!journeyModesOn()) return undefined;
  try {
    const { loadWorkItems } = await import('./load');
    // The same options as the sidebar counts (journey-counts-server.ts), so both share one read.
    const list = await loadWorkItems(subject, issuer, { rooms: uxSwitchOn('CORRIDRA_UX_ROAD') });
    const reference = list.items.find(
      (item) => item.kind === 'request' && item.id === requestId,
    )?.reference;
    return reference && shape.test(reference) ? reference : undefined;
  } catch {
    return undefined;
  }
}
