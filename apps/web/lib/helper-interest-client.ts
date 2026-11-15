import type { HelperInterestList } from '@corridra/auth/helper-interest';
import { ActionError, readJson, withStepUp } from './ux/step-up';

// The owner and admin list of the helper interest register (ADR-0085): read the entries and delete one on request.
// The server and the database decide who may do either, with a fresh authenticator check; a refusal is only told.
const route = '/api/helper-interest';
export const helperInterestFragment = 'helper-interest-list';
export const canReadHelperInterest = (role: string | null | undefined) =>
  role === 'owner' || role === 'admin';

export const helperInterestWords = {
  title: 'Helper Interest',
  intro:
    'People who are not invited yet and told us they would like to become field helpers. This is only a note of interest: it is not an invitation. Entries are deleted automatically after 180 days. You can delete one sooner if the person asks.',
  load: 'Load Entries',
  loading: 'Loading',
  more: 'Load More Entries',
  empty: 'There are no entries.',
  chooseLoad: 'Press Load Entries to read them.',
  loadFailed: 'The entries could not be read. Try again.',
  deleteFailed: 'The entry could not be deleted. Try again.',
  remove: 'Delete',
  confirm: 'Delete this entry for good?',
  confirmYes: 'Delete Entry',
  confirmNo: 'Keep It',
  deleted: 'The entry was deleted.',
  reason: 'Their words',
  summary: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  waiting: (total: number) => `${total} in all`,
};

const url = (tenant: string, params: Record<string, string> = {}) =>
  `${route}?${new URLSearchParams({ tenant, ...params }).toString()}`;

/** Whether the module is installed. Any failure means no, so the panel stays hidden. */
export async function helperInterestInstalled(
  tenant: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(url(tenant, { view: 'installed' }), {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return false;
    return ((await response.json()) as { installed?: unknown }).installed === true;
  } catch {
    return false;
  }
}

export async function readHelperInterest(
  tenant: string,
  offset: number,
  fetcher: typeof fetch = fetch,
): Promise<HelperInterestList> {
  const page = await withStepUp(async () =>
    readJson<HelperInterestList>(
      await fetcher(url(tenant, { offset: String(offset) }), {
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    ),
  );
  if (!Array.isArray(page?.rows) || typeof page.total !== 'number')
    throw new ActionError(helperInterestWords.loadFailed, 502);
  return page;
}

export async function deleteHelperInterest(
  tenant: string,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  return withStepUp(async () =>
    readJson<{ removed: boolean }>(
      await fetcher(url(tenant), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      }),
    ),
  );
}

export const helperInterestFailure = (error: unknown, fallback: string) =>
  error instanceof ActionError && error.message ? error.message : fallback;

export type HelperInterestPage = { total: number; nextOffset: number | null };

/**
 * The paging state after one loaded entry was deleted. The list pages by position, so every later entry moves up by one: the next
 * page starts one earlier, and there is no next page once everything left has been read.
 */
export function pageAfterDelete(current: HelperInterestPage): HelperInterestPage {
  const total = Math.max(0, current.total - 1);
  const next = current.nextOffset === null ? null : Math.max(0, current.nextOffset - 1);
  return { total, nextOffset: next !== null && next < total ? next : null };
}
