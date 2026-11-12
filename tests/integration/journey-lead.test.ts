import { describe, expect, it } from 'vitest';
import { leadFirst, type JourneyCard } from '../../apps/web/app/account/move/journeys';

// The lead journey card on Home (locked AC/1 look, revision 2): the journey with the most recent activity is drawn
// first and widest; on a tie or a missing date Sourcing leads; the other cards keep the usual order.
const card = (journey: JourneyCard['journey'], at: string): JourneyCard => ({
  journey,
  id: `${journey}-1`,
  workspaceId: 'w1',
  count: '1',
  title: null,
  kind: 'request',
  status: '',
  statusWords: '',
  dateWords: '',
  at,
  href: `/account/rooms/${journey}-1`,
  listHref: `/account?view=work&work=${journey}`,
});
const order = (cards: JourneyCard[]) => leadFirst(cards).map((c) => c.journey);

describe('the lead journey card', () => {
  it('puts the journey with the newest activity first', () => {
    expect(
      order([
        card('source', '2026-10-01T00:00:00Z'),
        card('sell', '2026-11-04T00:00:00Z'),
        card('organise', '2026-10-20T00:00:00Z'),
      ]),
    ).toEqual(['sell', 'source', 'organise']);
  });

  it('keeps Sourcing first when the dates are equal', () => {
    const at = '2026-11-01T00:00:00Z';
    expect(order([card('source', at), card('sell', at), card('organise', at)])).toEqual([
      'source',
      'sell',
      'organise',
    ]);
  });

  it('keeps Sourcing first when no card has a date, and never lets a missing date lead', () => {
    expect(order([card('source', ''), card('sell', ''), card('organise', '')])).toEqual([
      'source',
      'sell',
      'organise',
    ]);
    expect(order([card('source', ''), card('organise', '2026-09-01T00:00:00Z')])).toEqual([
      'organise',
      'source',
    ]);
  });

  it('keeps the other cards in the usual order behind the lead', () => {
    expect(
      order([
        card('source', '2026-10-01T00:00:00Z'),
        card('sell', '2026-09-01T00:00:00Z'),
        card('organise', '2026-11-01T00:00:00Z'),
      ]),
    ).toEqual(['organise', 'source', 'sell']);
  });

  it('leaves a single card and no cards as they are, without changing the input', () => {
    const one = [card('sell', '2026-11-01T00:00:00Z')];
    expect(leadFirst(one)).toEqual(one);
    expect(leadFirst([])).toEqual([]);
    const input = [card('source', '2026-01-01T00:00:00Z'), card('sell', '2026-02-01T00:00:00Z')];
    leadFirst(input);
    expect(input.map((c) => c.journey)).toEqual(['source', 'sell']);
  });
});
