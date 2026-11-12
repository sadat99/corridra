import type { StaffApplicationPage } from '@corridra/auth/customer-programme-publication';
import { ActionError, readJson, withStepUp } from './ux/step-up';

// Corridra staff reading applications to public programme pages (ADR-080, owner decision of 12 November 2026). Read
// only: this file has a read and no write. The server and the database decide who may read; a refusal is only told.
export const applicationQueueFragment = 'programme-application-queue';
export const applicationPageSize = 10;
const route = '/api/workspace/programme-applications';

/** Only an owner or an admin sees the list; the server decides again with the membership and a fresh authenticator check. */
export const canReadApplications = (role: string | null | undefined) =>
  role === 'owner' || role === 'admin';

export const applicationStatusLabels: Record<string, string> = {
  SUBMITTED: 'Waiting for the organiser',
  WAITLISTED: 'On the waiting list',
  DECLINED: 'Declined',
  INVITED: 'Invited',
  INVITATION_EXPIRED: 'Invitation expired',
  JOINED: 'Joined',
  REGISTRATION_ENDED: 'No longer registered',
  WITHDRAWN: 'Withdrawn',
};

export const applicationWords = {
  title: 'Programme Applications',
  intro:
    'What people wrote when they applied to a public programme page. You can read them here. You cannot change or answer them: the organiser decides.',
  load: 'Load Applications',
  loading: 'Loading',
  more: 'Load More Applications',
  empty: 'There are no applications yet.',
  chooseLoad: 'Press Load Applications to read them.',
  loadFailed: 'The applications could not be read. Try again.',
  showWords: 'Show Their Words',
  statement: 'What they wrote',
  note: "Organiser's note",
  organiser: 'Organiser',
  summary: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  waiting: (total: number) => `${total} in all`,
};

const url = (tenant: string, params: Record<string, string> = {}) =>
  `${route}?${new URLSearchParams({ tenant, ...params }).toString()}`;

/** One page, newest first. Asks for a fresh authenticator check when the server does. */
export async function readApplications(
  tenant: string,
  after: string | null,
  fetcher: typeof fetch = fetch,
): Promise<StaffApplicationPage> {
  const params: Record<string, string> = { pageSize: String(applicationPageSize) };
  if (after !== null) params.after = after;
  const page = await withStepUp(async () =>
    readJson<StaffApplicationPage>(
      await fetcher(url(tenant, params), { cache: 'no-store', credentials: 'same-origin' }),
    ),
  );
  if (!Array.isArray(page?.applications) || typeof page.total !== 'number')
    throw new ActionError(applicationWords.loadFailed, 502);
  return page;
}

/** The sentence for a failed read: the server's own words when it sent some, otherwise one plain line. */
export function applicationFailure(error: unknown): string {
  return error instanceof ActionError && error.message
    ? error.message
    : applicationWords.loadFailed;
}
