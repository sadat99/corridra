import type { RequestContext } from '@corridra/db';

/** The same three counts as the Today list. A count that cannot be read is null, never zero. */
export type WaitingItem = { key: string; label: string; detail: string; count: number | null };

type QueueReader = {
  queue(
    ctx: RequestContext,
    filter: 'all' | 'open' | 'overdue',
    offset: number,
    filters: { stage?: 'DRAFT' },
  ): Promise<{ total: number }>;
};

export async function waitingOnTeam(
  missions: QueueReader,
  ctx: RequestContext,
): Promise<WaitingItem[]> {
  const read = async (filter: 'open' | 'overdue', filters: { stage?: 'DRAFT' }) => {
    try {
      const { total } = await missions.queue(ctx, filter, 0, filters);
      return Number.isInteger(total) && total >= 0 ? total : null;
    } catch {
      return null;
    }
  };
  const [fresh, overdue, open] = await Promise.all([
    read('open', { stage: 'DRAFT' }),
    read('overdue', {}),
    read('open', {}),
  ]);
  return [
    {
      key: 'fresh',
      label: 'New requests to review',
      detail: 'Requests that no one on the team has started.',
      count: fresh,
    },
    {
      key: 'overdue',
      label: 'Requests past their due date',
      detail: 'Open requests whose due date has passed.',
      count: overdue,
    },
    {
      key: 'open',
      label: 'Open requests',
      detail: 'All requests that are not closed or cancelled.',
      count: open,
    },
  ];
}
