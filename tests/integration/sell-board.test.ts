import { describe, expect, it } from 'vitest';
import type { MissionExperience } from '../../packages/delivery/src/report';
import { sellBoard } from '../../apps/web/lib/sell-board';
import { sellFacts } from '../../apps/web/lib/home-journeys/facts';

// The Sell room's buyers view (approved work rooms, 5 Nov 2026): the funnel uses Home's own counting rules, the
// follow-ups are the recorded outcomes, and a buyer is shown as the report states it.
const buyer = (id: string, company: string, fit: string) =>
  ({
    id,
    company,
    country: 'Madrid, Spain',
    fit,
    rationale: 'Fits',
    uncertainty: 'None',
    gaps: 'None',
    verification: 'Source-reported; no independent verification asserted',
  }) as MissionExperience['shortlist'][number];
const item = (id: string, state: string, meetings: { id: string; status: string }[] = []) => ({
  id,
  itemId: id,
  version: 1,
  label: 'Buyer meeting',
  state,
  nextAction: 'Confirm',
  dueAt: '2026-11-12T00:00:00Z',
  responsibility: 'Team',
  meetings: meetings.map((m) => ({ ...m, scheduleChanged: false })),
});
const e: MissionExperience = {
  schemaVersion: 1,
  requirements: null,
  shortlist: [
    buyer('b1', 'Galicia Moda', 'RESEARCH'),
    buyer('b2', 'Moda Ibérica', 'STRONG'),
    buyer('b3', '上海针织', 'POSSIBLE'),
    buyer('b4', 'Odd Co', 'SOMETHING_NEW'),
  ],
  quotations: [],
  agenda: [
    item('a1', 'PROPOSED'),
    item('a2', 'CONFIRMED', [{ id: 'm1', status: 'HELD' }]),
    item('a3', 'CANCELLED'),
  ],
  documentAccess: 'None',
};
const outcomes = {
  opportunities: 3,
  qualified: 2,
  proposals: 1,
  contracts: 1,
  rfqs: 2,
  samples: 1,
  heldMeetings: 1,
};

describe('the Sell room buyers view', () => {
  it('counts the funnel exactly as Home does, and each recorded outcome on its own', () => {
    const { funnel } = sellBoard(e, outcomes);
    expect(funnel).toEqual({
      ...sellFacts([e]),
      priceRequests: 2,
      samples: 1,
      proposals: 1,
      agreements: 1,
    });
    expect(funnel).toMatchObject({ shortlisted: 4, proposed: 1, confirmed: 1, held: 1 });
  });

  // Regression (Sell lane, 11 Nov 2026): price requests, samples and agreements were added into one number and
  // proposals were left out. A price request or a sample is not an agreed transaction.
  it('never adds a price request, a sample or a proposal to the agreements', () => {
    const only = (part: Partial<typeof outcomes>) =>
      sellBoard(e, { ...outcomes, rfqs: 0, samples: 0, proposals: 0, contracts: 0, ...part })
        .funnel;
    expect(only({ rfqs: 3 })).toMatchObject({
      priceRequests: 3,
      samples: 0,
      proposals: 0,
      agreements: 0,
    });
    expect(only({ samples: 2 })).toMatchObject({ priceRequests: 0, samples: 2, agreements: 0 });
    expect(only({ proposals: 5 })).toMatchObject({ proposals: 5, agreements: 0 });
    expect(only({ contracts: 1 })).toMatchObject({
      priceRequests: 0,
      samples: 0,
      proposals: 0,
      agreements: 1,
    });
    expect(Object.keys(sellBoard(e, outcomes).funnel)).not.toContain('followUps');
  });

  it('says a count the report does not carry is unknown, never zero', () => {
    expect(sellBoard(e, null).funnel).toMatchObject({
      priceRequests: null,
      samples: null,
      proposals: null,
      agreements: null,
    });
  });

  it('lists the strongest fits first, in plain words, and an unknown fit as written', () => {
    const { buyers } = sellBoard(e, outcomes);
    expect(buyers.map((b) => [b.company, b.fit])).toEqual([
      ['Moda Ibérica', 'Strong fit'],
      ['上海针织', 'Possible fit'],
      ['Galicia Moda', 'Being assessed'],
      ['Odd Co', 'something_new'],
    ]);
    expect(buyers[1]!.companyLang).toBe('zh');
    expect(buyers[0]!.backing).toBe('Source-reported; no independent verification asserted');
  });

  it('never attaches a meeting to a buyer: the report does not link them', () => {
    for (const row of sellBoard(e, outcomes).buyers)
      expect(Object.keys(row).sort()).toEqual(
        ['backing', 'company', 'companyLang', 'fit', 'id', 'place'].sort(),
      );
  });
});
