import { describe, expect, it } from 'vitest';
import type { MissionExperience } from '../../packages/delivery/src/report';
import {
  experiencesOf,
  organiseFacts,
  participantFacts,
  savedReportIds,
  sellFacts,
  sourceFacts,
} from '../../apps/web/lib/home-journeys/facts';
import { compareExperienceOffers } from '../../apps/web/lib/experience-offers';
import {
  isJourney,
  journeyOfTask,
  journeyTargets,
  journeysOf,
} from '../../apps/web/app/account/move/journeys';
import type { WorkItem, WorkList } from '../../apps/web/lib/work-items/types';

// Home's journey numbers (owner-approved role mockup, 5 Nov 2026). Each number is a count of records the
// person can already open, from the same engine the report page uses; nothing unread is drawn as zero.
const at = '2026-11-05T00:00:00Z';
const complete = {
  specification: 'Ring spinning frame',
  quantity: '2',
  unit: 'set',
  unitPriceMinor: '1000',
  totalPriceMinor: '2000',
  toolingMinor: '0',
  setupMinor: '0',
  packagingMinor: '0',
  leadTime: '90 days',
  validUntil: '2027-01-01T00:00:00Z',
  incoterm: 'FOB' as const,
  shipping: 'INCLUDED' as const,
  paymentTerms: '30 percent deposit',
};
const offer = (
  over: Partial<MissionExperience['quotations'][number]>,
): MissionExperience['quotations'][number] => ({
  id: 'q1',
  targetId: 't1',
  currency: 'USD',
  terms: complete,
  revision: 1,
  uncertainties: 'None stated',
  sourceKind: 'SUPPLIER_DOCUMENT',
  claimStatus: 'VERIFIED',
  superseded: false,
  assignmentCurrent: true,
  ...over,
});
const experience = (over: Partial<MissionExperience>): MissionExperience => ({
  schemaVersion: 1,
  requirements: {
    version: 1,
    fields: { objective: 'Buy machinery', role: 'BUYER', product: 'Spinning frames' },
    sourceKind: 'CUSTOMER',
    claimStatus: 'SELF_DECLARED',
    current: true,
  },
  shortlist: [],
  quotations: [],
  agenda: [],
  documentAccess: 'NONE',
  ...over,
});

describe('Sourcing numbers on Home', () => {
  it('counts only current offers, with the same verdicts as the report page', () => {
    const e = experience({
      quotations: [
        offer({ id: 'a' }),
        offer({ id: 'b', targetId: 't2', claimStatus: 'EVIDENCE_AVAILABLE' }),
        offer({
          id: 'c',
          targetId: 't3',
          claimStatus: 'SELF_DECLARED',
          terms: { ...complete, paymentTerms: undefined },
        }),
        offer({ id: 'old', superseded: true }),
        offer({ id: 'past', assignmentCurrent: false }),
      ],
    });
    const facts = sourceFacts([e], at);
    expect(facts).toEqual({
      quotes: 3,
      notComparable: 1,
      verified: 1,
      evidence: 1,
      selfDeclared: 1,
    });
    // The not comparable count is the engine's own verdict on the current offers, never a second rule.
    const verdicts = compareExperienceOffers(e, at);
    expect(
      e.quotations.filter(
        (q, i) =>
          !q.superseded &&
          q.assignmentCurrent &&
          verdicts[i]?.status !== 'COMPARABLE ON SUPPLIED TERMS',
      ).length,
    ).toBe(facts.notComparable);
  });

  it('counts nothing as current when the request was changed after the offers', () => {
    const e = experience({ quotations: [offer({})] });
    e.requirements!.current = false;
    expect(sourceFacts([e], at).quotes).toBe(0);
  });
});

describe('Selling numbers on Home', () => {
  it('counts shortlisted companies, proposed and confirmed visits, and each held meeting once', () => {
    const meeting = (id: string, status: string) => ({ id, status, scheduleChanged: false });
    let n = 0;
    const item = (state: string, meetings: ReturnType<typeof meeting>[]) => ({
      id: `${state}-${++n}`,
      itemId: `visit-${n}`,
      version: 1,
      label: 'Visit',
      state,
      nextAction: 'Prepare',
      dueAt: at,
      responsibility: 'Team',
      meetings,
    });
    const facts = sellFacts([
      experience({
        shortlist: [{ id: 't1' }, { id: 't2' }] as MissionExperience['shortlist'],
        agenda: [
          item('PROPOSED', []),
          item('PROPOSED', []),
          item('CONFIRMED', [meeting('m1', 'HELD'), meeting('m2', 'SCHEDULED')]),
          item('REVIEW_REQUIRED', [meeting('m1', 'HELD')]),
          item('CANCELLED', []),
        ],
      }),
    ]);
    expect(facts).toEqual({ shortlisted: 2, proposed: 2, confirmed: 1, held: 1 });
  });

  it('reads experiences only from well formed report missions', () => {
    expect(experiencesOf(null)).toEqual([]);
    expect(experiencesOf({ missions: [{ experience: { quotations: 'x' } }, {}] })).toEqual([]);
    expect(experiencesOf({ missions: [{ experience: experience({}) }] })).toHaveLength(1);
  });
});

describe('two saved reports of one request (guardian review of PR 310)', () => {
  it('counts each quote, company, visit and meeting once, and only the newest version of a visit', () => {
    const meeting = (id: string, status: string) => ({ id, status, scheduleChanged: false });
    const item = (
      itemId: string,
      version: number,
      state: string,
      meetings = [meeting('m1', 'HELD')],
    ) => ({
      id: `${itemId}-v${version}`,
      itemId,
      version,
      label: 'Visit',
      state,
      nextAction: 'Prepare',
      dueAt: at,
      responsibility: 'Team',
      meetings,
    });
    const first = experience({
      quotations: [offer({ id: 'a' }), offer({ id: 'b', targetId: 't2' })],
      shortlist: [{ id: 't1' }, { id: 't2' }] as MissionExperience['shortlist'],
      agenda: [item('v1', 1, 'PROPOSED')],
    });
    const second = experience({
      quotations: [offer({ id: 'a' }), offer({ id: 'b', targetId: 't2' })],
      shortlist: [{ id: 't1' }, { id: 't2' }] as MissionExperience['shortlist'],
      agenda: [item('v1', 2, 'CONFIRMED')],
    });
    expect(sourceFacts([first, second], at).quotes).toBe(sourceFacts([first], at).quotes);
    expect(sellFacts([first, second])).toEqual({
      shortlisted: 2,
      proposed: 0,
      confirmed: 1,
      held: 1,
    });
  });

  it('counts saved reports only when every open report is saved and Home opens them all', () => {
    const a = (requestId: string, savedResourceId?: string, available = true) => ({
      requestId,
      savedResourceId,
      available,
    });
    expect(savedReportIds([a('r1', 's1'), a('r1', 's2'), a('r2', 's9')], 'r1', 3)).toEqual([
      's1',
      's2',
    ]);
    // Not yet saved, unsaved alongside saved, or more than Home opens: no numbers, never a partial count.
    expect(savedReportIds([a('r1')], 'r1', 3)).toBeNull();
    expect(savedReportIds([a('r1', 's1'), a('r1')], 'r1', 3)).toBeNull();
    expect(savedReportIds([a('r1', 's1'), a('r1', 's2')], 'r1', 1)).toBeNull();
    // An expired or withdrawn report is not open, so it neither counts nor blocks.
    expect(savedReportIds([a('r1', 's1'), a('r1', undefined, false)], 'r1', 3)).toEqual(['s1']);
  });

  it('says "or more" for registrations beyond the page read', () => {
    expect(
      participantFacts({ registrations: [{ status: 'REGISTERED', name: 'Milan' }], nextAfter: 'x' })
        ?.more,
    ).toBe(true);
  });
});

describe('Organising numbers on Home', () => {
  it('keeps a number participants did not share as null, never zero', () => {
    const facts = organiseFacts(
      {
        readiness: { activeParticipants: 12, readyParticipants: 9 },
        meetings: { scheduled: null, qualifiedHeld: null },
        conflicts: [{ left: 'a', right: 'b' }],
        context: {
          startsAt: '2027-04-09T00:00:00Z',
          endsAt: '2027-04-13T00:00:00Z',
          timezone: 'Asia/Shanghai',
        },
      },
      { invitations: [{ status: 'ISSUED' }, { status: 'REVOKED' }, { status: 'ISSUED' }] },
    );
    expect(facts).toMatchObject({
      participants: 12,
      ready: 9,
      invitationsOpen: '2',
      scheduled: null,
      qualifiedHeld: null,
      conflicts: 1,
      timezone: 'Asia/Shanghai',
    });
  });

  it('says "or more" when only the first page of invitations was read, and nothing without the list', () => {
    expect(
      organiseFacts({}, { invitations: [{ status: 'ISSUED' }], nextInvitationAfter: 'x' })
        ?.invitationsOpen,
    ).toBe('1 or more');
    expect(organiseFacts({}, null)?.invitationsOpen).toBeNull();
    expect(organiseFacts(null, null)).toBeNull();
  });
});

describe('Taking part on Home', () => {
  it('appears only for a programme the person is registered for', () => {
    expect(participantFacts(null)).toBeNull();
    expect(participantFacts({ registrations: [{ status: 'WITHDRAWN', name: 'Old' }] })).toBeNull();
    expect(
      participantFacts({
        registrations: [
          { status: 'WITHDRAWN', name: 'Old' },
          { status: 'REGISTERED', name: 'Milan delegation', consentedAt: at },
        ],
      }),
    ).toEqual({
      registered: 1,
      more: false,
      name: 'Milan delegation',
      consented: true,
      href: '/account/delegations',
    });
  });
});

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
const list = (items: WorkItem[]): WorkList => ({
  items,
  unreadable: [],
  partial: false,
  skippedWorkspaces: 0,
  workspaces: [{ id: 'w1', name: 'Atelier' }],
});

describe('the journey switch on Home', () => {
  const work = list([
    item({ id: 'r1', family: 'SOURCE' }),
    item({ id: 'r2', family: 'SELL' }),
    item({ key: 'draft:d1', kind: 'draft', id: 'd1', family: 'ORGANISE' }),
    item({ id: 'r3', family: 'UNCLASSIFIED' }),
  ]);

  it('tags each task by its own record or its request, and leaves unknown work under All only', () => {
    expect(journeyOfTask(work, { kind: 'draft', id: 'draft:d1' })).toBe('organise');
    expect(journeyOfTask(work, { kind: 'request', id: 'request:r2' })).toBe('sell');
    expect(journeyOfTask(work, { kind: 'move', id: 'move:m1', requestId: 'r1' })).toBe('source');
    expect(journeyOfTask(work, { kind: 'report', id: 'report:p1', requestId: 'r3' })).toBeNull();
    expect(journeyOfTask(work, { kind: 'quote', id: 'quote:q1' })).toBeNull();
    expect(journeyOfTask(work, { kind: 'move', id: 'move:m2', requestId: 'missing' })).toBeNull();
  });

  it('accepts only a known journey in the address', () => {
    expect(['source', 'sell', 'organise'].every(isJourney)).toBe(true);
    expect(isJourney('participant')).toBe(false);
    expect(isJourney(['sell'])).toBe(false);
    expect(isJourney(undefined)).toBe(false);
  });

  it('reads numbers only for a sent request or a programme, never for a draft', () => {
    const { cards } = journeysOf(
      list([
        item({ id: 'r1', family: 'SOURCE' }),
        item({ key: 'draft:d2', kind: 'draft', id: 'd2', family: 'SELL' }),
        item({
          key: 'programme:p1',
          kind: 'programme',
          id: 'p1',
          workspaceId: 'w9',
          family: 'ORGANISE',
          status: '',
        }),
      ]),
      null,
    );
    expect(journeyTargets(cards)).toEqual({
      source: 'r1',
      sell: null,
      organise: { workspaceId: 'w9', programmeId: 'p1' },
    });
  });
});
