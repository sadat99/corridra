// Reads, for one request, whether a delivered report exists and whether it was saved. Server only,
// and only when delivery is on. A failure leaves the Room without a report; it never guesses.
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { foundations } from './foundations';
import { roomLinkFor, type RoomLink } from './room';

const none: RoomLink = { reportAvailable: false, savedResourceId: null };
const maxPages = 4;

export async function loadRoomLink(
  requestId: string,
  subject: string,
  issuer: string,
): Promise<RoomLink> {
  if (!customerDeliveryEnabled()) return none;
  const services = foundations();
  if (!services) return none;
  try {
    await services.ready;
    const rows: unknown[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = (await services.customerAssignedMissions.list(
        { pageSize: 25, ...(after ? { after } : {}) },
        subject,
        issuer,
      )) as { assignments?: unknown[]; nextAfter?: string | null };
      rows.push(...(result.assignments ?? []));
      if (!result.nextAfter) break;
      after = result.nextAfter;
    }
    return roomLinkFor(requestId, rows);
  } catch {
    return none;
  }
}
