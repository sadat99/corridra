import { describe, expect, it } from 'vitest';
import { journeysOf } from '../../apps/web/app/account/move/journeys';
import type { WorkItem, WorkList } from '../../apps/web/lib/work-items/types';

// Home's journey cards (owner-approved mockup, 5 Nov 2026): the newest piece of work per journey, from the
// work list. No card without work, "or more" when the list is incomplete, the stored title or nothing.
const item = (over: Partial<WorkItem>): WorkItem => ({
  key: `request:${over.id ?? 'r1'}`,
  kind: 'request',
  id: 'r1',
  workspaceId: 'w1',
  family: 'SOURCE',
  title: 'Spinning machinery',
  status: 'SHORTLIST',
  at: '2026-11-01T00:00:00Z',
  atKind: 'created',
  href: '/account/requests/r1',
  ...over,
});
const list = (items: WorkItem[], partial = false): WorkList => ({
  items,
  unreadable: [],
  partial,
  skippedWorkspaces: 0,
  workspaces: [{ id: 'w1', name: 'Atelier' }],
});

describe('journey cards on Home', () => {
  it('shows one card per journey the person has, newest first, and none for an empty journey', () => {
    const { cards } = journeysOf(
      list([
        item({ id: 'a', at: '2026-10-01T00:00:00Z', title: 'Older' }),
        item({ id: 'b', at: '2026-11-02T00:00:00Z', title: 'Newer' }),
        item({ id: 'c', family: 'ORGANISE', kind: 'programme', status: '', title: 'Mission' }),
      ]),
      null,
    );
    expect(cards.map((c) => c.journey)).toEqual(['source', 'organise']);
    expect(cards[0]).toMatchObject({ title: 'Newer', count: '2', status: 'SHORTLIST' });
    expect(cards[1]).toMatchObject({ title: 'Mission', count: '1', status: '' });
  });

  it('says "or more" when the list could not be read in full', () => {
    const { cards } = journeysOf(list([item({})], true), null);
    expect(cards[0]?.count).toBe('1 or more');
  });

  it('gives the latest request its stored title and journey, and nothing when it is not in the list', () => {
    const work = list([item({ id: 'r9', family: 'SELL', title: 'Buyers in Spain' })]);
    expect(journeysOf(work, 'r9').latest).toMatchObject({
      title: 'Buyers in Spain',
      journey: 'sell',
    });
    expect(journeysOf(work, 'missing').latest).toBeNull();
  });

  it('never classifies unclassified work into a journey', () => {
    expect(journeysOf(list([item({ family: 'UNCLASSIFIED' })]), null).cards).toEqual([]);
  });
});
