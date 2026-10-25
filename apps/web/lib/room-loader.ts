// Reads, for one request, whether a delivered report exists and whether it was saved. Server only,
// and only when delivery is on. A failure leaves the Room without a report; it never guesses.
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { foundations } from './foundations';
import { followAssignments, type RoomLink } from './room';

const none: RoomLink = { reportAvailable: false, savedResourceId: null };

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
    return await followAssignments(
      requestId,
      async (after) =>
        (await services.customerAssignedMissions.list(
          { pageSize: 25, ...(after ? { after } : {}) },
          subject,
          issuer,
        )) as { assignments?: unknown[]; nextAfter?: string | null },
    );
  } catch {
    return none;
  }
}
