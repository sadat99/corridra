// Reads, for one request, the delivered reports the person may read and which of them are saved. Server only,
// and only when delivery is on. A failed read is said as a failed read: it is never shown as "nothing yet", and it
// never guesses a report.
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { foundations } from './foundations';
import { followRoomReports, resolveRoomTask, type RoomLink, type RoomResolution } from './room';

const none: RoomLink = { reportAvailable: false, savedResourceId: null };

export type RoomLoad =
  | ({ status: 'ok' } & RoomResolution)
  /** The list could not be read: nothing is known, so nothing is claimed and nothing is offered to save. */
  | { status: 'unreadable'; link: RoomLink };

type Page = (after?: string) => Promise<{ assignments?: unknown[]; nextAfter?: string | null }>;

/**
 * The Room's answer from one person's assignment pages. Any failure while reading them, including a page the
 * provider could not give, is `unreadable`: it is never shown as "nothing yet" and never offers a save.
 */
export async function roomLoadFrom(
  requestId: string,
  page: Page,
  report?: string,
): Promise<RoomLoad> {
  try {
    return { status: 'ok', ...resolveRoomTask(await followRoomReports(requestId, page), report) };
  } catch {
    return { status: 'unreadable', link: none };
  }
}

/**
 * `report` is a hint from the address, already checked as a uuid. It is resolved only against the list read here
 * with this person's own session, so it can choose among their reports and never reach another one.
 */
export async function loadRoomLink(
  requestId: string,
  subject: string,
  issuer: string,
  report?: string,
): Promise<RoomLoad> {
  if (!customerDeliveryEnabled())
    return { status: 'ok', ...resolveRoomTask({ reports: [], complete: true }) };
  const services = foundations();
  if (!services) return { status: 'unreadable', link: none };
  return roomLoadFrom(
    requestId,
    async (after) => {
      await services.ready;
      return (await services.customerAssignedMissions.list(
        { pageSize: 25, ...(after ? { after } : {}) },
        subject,
        issuer,
      )) as { assignments?: unknown[]; nextAfter?: string | null };
    },
    report,
  );
}
