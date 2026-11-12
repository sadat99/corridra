import { describe, expect, it, vi } from 'vitest';
import {
  afterSaveHref,
  followRoomReports,
  initialLensFor,
  resolveRoomTask,
  roomReportsFor,
  type RoomReport,
} from '../../apps/web/lib/room';
import { buildMoveModel, type MoveInput } from '../../apps/web/lib/move-cards';
import { missingTermNotice } from '../../apps/web/components/missing-term-notice';
import type { MissionExperience } from '../../packages/delivery/src/report';

// The loader's service wiring is not under test here; its answer to the pages it reads is.
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));

// The returning buyer's path from an approved delivered report to the comparison (customer handoff lane). These
// prove, without a browser: which report the Room treats as the task and that an address hint never decides more
// than the person's own list allows; that a failed read is a failed read; where a Home report card goes; and what
// the notice above the comparison says, from the engine's own verdict, in the original currency and exact units.

const request = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const a1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const a2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const a3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const s1 = '33333333-3333-4333-8333-333333333331';
const now = Date.parse('2026-11-12T00:00:00Z');
const later = '2099-01-01T00:00:00Z';
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  requestId: request,
  available: true,
  title: `Report ${id.slice(-1)}`,
  expiresAt: later,
  savedResourceId: null,
  ...over,
});
const report = (id: string, saved: string | null = null): RoomReport => ({
  assignmentId: id,
  savedResourceId: saved,
  title: `Report ${id.slice(-1)}`,
  expiresAt: later,
});

describe('the reports one request has', () => {
  it('keeps only readable, current reports for this request; others are closed or ignored', () => {
    const read = roomReportsFor(
      request,
      [
        row(a1),
        row(a2, { savedResourceId: s1 }),
        row(a3, { available: false, title: undefined, expiresAt: undefined }),
        row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', { requestId: other }),
        row('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', { expiresAt: '2026-11-11T00:00:00Z' }),
        row('not-a-uuid'),
        row(a1),
        null,
        'junk',
      ],
      now,
    );
    expect(read.reports).toEqual([report(a1), report(a2, s1)]);
    expect(read.closed).toEqual([a3, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1']);
  });
  it('a malformed saved id is not trusted as saved', () => {
    expect(
      roomReportsFor(request, [row(a1, { savedResourceId: '../x' })], now).reports[0]
        ?.savedResourceId,
    ).toBeNull();
  });
});

describe('every page is read before a report is chosen', () => {
  it('reads past the first report, so a newer one on a later page is seen', async () => {
    const pages: Record<string, { assignments: unknown[]; nextAfter: string | null }> = {
      start: { assignments: [row(a1, { savedResourceId: s1 })], nextAfter: a1 },
      [a1]: { assignments: [row(a2)], nextAfter: null },
    };
    const read = await followRoomReports(
      request,
      async (after) => pages[after ?? 'start']!,
      5,
      now,
    );
    expect(read.complete).toBe(true);
    expect(read.reports.map((r) => r.assignmentId)).toEqual([a1, a2]);
  });
  it('a list cut short by the bound, or one that points back at itself, is not complete', async () => {
    let n = 0;
    const endless = async () => ({
      assignments: [],
      nextAfter: `dddddddd-dddd-4ddd-8ddd-${String(++n).padStart(12, '0')}`,
    });
    expect((await followRoomReports(request, endless, 3, now)).complete).toBe(false);
    const loop = async () => ({ assignments: [row(a1)], nextAfter: a1 });
    expect((await followRoomReports(request, loop, 3, now)).complete).toBe(false);
  });
});

describe('which report is the task', () => {
  const done = (reports: RoomReport[], complete = true) => ({ reports, complete });
  it('no report: nothing to save and nothing claimed', () => {
    expect(resolveRoomTask(done([]))).toEqual({
      link: { reportAvailable: false, savedResourceId: null },
      task: { kind: 'none' },
      hintClosed: false,
      count: 0,
    });
  });
  it('one unsaved report, the only one: that report is the task', () => {
    const r = resolveRoomTask(done([report(a1)]));
    expect(r.task).toEqual({ kind: 'save', report: report(a1) });
    expect(r.link).toEqual({ reportAvailable: true, savedResourceId: null });
  });
  it('a saved report opens directly and asks for nothing', () => {
    const r = resolveRoomTask(done([report(a1, s1)]), a1);
    expect(r.task).toEqual({ kind: 'saved' });
    expect(r.link.savedResourceId).toBe(s1);
  });
  it('a hint that matches an unsaved report makes it the task, even beside an older saved one', () => {
    const r = resolveRoomTask(done([report(a1, s1), report(a2)]), a2);
    expect(r.task).toEqual({ kind: 'save', report: report(a2) });
    // The report already saved stays reachable in the Room while the hinted one waits to be saved.
    expect(r.link.savedResourceId).toBe(s1);
  });
  it('several reports and no settling hint: the person chooses among the unsaved ones', () => {
    const r = resolveRoomTask(done([report(a1, s1), report(a2), report(a3)]));
    expect(r.task).toEqual({ kind: 'choose', reports: [report(a2), report(a3)] });
    expect(r.link.savedResourceId).toBe(s1);
  });
  it('an older saved report never hides a newer unsaved one', () => {
    expect(resolveRoomTask(done([report(a1, s1), report(a2)])).task).toEqual({
      kind: 'choose',
      reports: [report(a2)],
    });
  });
  it('a list that was not read to the end never settles the choice alone', () => {
    expect(resolveRoomTask(done([report(a1)], false)).task).toEqual({
      kind: 'choose',
      reports: [report(a1)],
    });
  });
  it('a hint for a report not open to this person is said plainly and grants nothing', () => {
    const closed = resolveRoomTask(done([report(a1)]), a3);
    expect(closed.hintClosed).toBe(true);
    // The real state stays: the person's own report is still the task.
    expect(closed.task).toEqual({ kind: 'save', report: report(a1) });
    const nothing = resolveRoomTask(done([]), a3);
    expect(nothing).toMatchObject({ hintClosed: true, task: { kind: 'none' } });
    expect(nothing.link).toEqual({ reportAvailable: false, savedResourceId: null });
  });
});

describe('the address after a confirmed save and the lens it opens', () => {
  it('names the saved report only when the request has more than one', () => {
    expect(afterSaveHref(request, a1, 1)).toBe(`/account/rooms/${request}?view=compare`);
    expect(afterSaveHref(request, a2, 2)).toBe(
      `/account/rooms/${request}?view=compare&report=${a2}`,
    );
  });
  it('compare is honoured only where the lenses exist; meetings keeps its own rule', () => {
    const on = { trip: false, lenses: true };
    expect(initialLensFor('compare', on)).toBe('compare');
    expect(initialLensFor('compare', { trip: true, lenses: false })).toBeUndefined();
    expect(initialLensFor(['compare'], on)).toBeUndefined();
    expect(initialLensFor('Compare', on)).toBeUndefined();
    expect(initialLensFor('meetings', on)).toBeUndefined();
    expect(initialLensFor('meetings', { trip: true, lenses: true })).toBe('trip');
  });
});

describe('where a Home report card goes', () => {
  const empty: MoveInput = {
    workspaces: [],
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [],
  };
  const input: MoveInput = {
    ...empty,
    reports: [
      {
        id: a1,
        title: 'Unsaved',
        requestId: request,
        publishedAt: '2026-11-02',
        href: '/account#assigned-missions',
      },
      {
        id: a2,
        title: 'Saved',
        requestId: request,
        publishedAt: '2026-11-01',
        href: `/account/missions/${s1}`,
      },
      {
        id: 'not-a-uuid',
        title: 'Odd',
        requestId: request,
        publishedAt: '2026-10-01',
        href: '/account#assigned-missions',
      },
    ],
  };
  const hrefs = (rooms: boolean) =>
    Object.fromEntries(
      buildMoveModel(input, { rooms })
        .cards.filter((c) => c.kind === 'report')
        .map((c) => [c.context, c.href]),
    );
  it('with the Room on, an unsaved report opens its Room naming the report; a saved one opens itself', () => {
    expect(hrefs(true)).toEqual({
      Unsaved: `/account/rooms/${request}?report=${a1}`,
      Saved: `/account/missions/${s1}`,
      Odd: '/account?view=results&tab=delivered',
    });
  });
  it('with the Room off, an unsaved report opens the Library Delivered tab', () => {
    expect(hrefs(false)).toEqual({
      Unsaved: '/account?view=results&tab=delivered',
      Saved: `/account/missions/${s1}`,
      Odd: '/account?view=results&tab=delivered',
    });
  });
});

describe('the notice above the comparison', () => {
  const terms = {
    specification: 'Auto cutter 2.5 m bed',
    quantity: '2',
    unit: 'unit',
    unitPriceMinor: '1840000',
    totalPriceMinor: '3680000',
    leadTime: '45 days',
    validUntil: '2099-01-01T00:00:00.000Z',
    incoterm: 'FOB',
    shipping: 'EXCLUDED',
    paymentTerms: '30% deposit',
    toolingMinor: '0',
    setupMinor: '0',
    packagingMinor: '0',
    installation: 'Included',
    warranty: 'One year',
    training: 'Two days',
    spares: 'Quoted separately',
  } as const;
  const offer = (id: string, targetId: string, t: Record<string, unknown>, over = {}) => ({
    id,
    targetId,
    currency: 'USD',
    terms: t,
    revision: 1,
    uncertainties: 'None stated',
    sourceKind: 'self_declaration',
    claimStatus: 'self_declared',
    superseded: false,
    assignmentCurrent: true,
    ...over,
  });
  const experience = (quotations: unknown[], assignmentType = 'machinery_procurement') =>
    ({
      schemaVersion: 1,
      requirements: {
        version: 1,
        fields: { objective: 'Cutting machine', role: 'BUYER' },
        sourceKind: 'self_declaration',
        claimStatus: 'self_declared',
        current: true,
        assignmentType,
      },
      shortlist: [
        { id: 't1', company: 'Lantern Cutting Works', country: 'China' },
        { id: 't2', company: '绿野机械有限公司', country: 'China' },
      ],
      quotations,
      agenda: [],
      documentAccess: 'None',
    }) as unknown as MissionExperience;
  const at = '2026-11-12T00:00:00Z';
  it('says who leaves out the machine set-up, quotes the other as written, and an exact equal price', () => {
    const view = missingTermNotice(
      experience([
        offer('qa', 't1', { ...terms, commissioning: 'Two engineers for five days' }),
        offer('qb', 't2', terms),
      ]),
      at,
    );
    expect(view).toEqual({
      title: 'One quote leaves out the machine set-up',
      lines: [
        {
          key: 'qb',
          supplier: '绿野机械有限公司',
          lang: 'zh',
          words: 'has not said who will set up and test the machine at your site.',
        },
        {
          key: 'qa:stated',
          supplier: 'Lantern Cutting Works',
          lang: undefined,
          words: 'quotes Two engineers for five days.',
        },
      ],
      samePrice: 'Both quotes are USD 18,400.00 a unit.',
    });
  });
  it('never calls prices equal across currencies or different minor units, and never converts', () => {
    const differ = (b: Record<string, unknown>, over = {}) =>
      missingTermNotice(
        experience([
          offer('qa', 't1', { ...terms, commissioning: 'Included' }),
          offer('qb', 't2', b, over),
        ]),
        at,
      )?.samePrice;
    expect(differ(terms, { currency: 'EUR' })).toBeNull();
    expect(differ({ ...terms, unitPriceMinor: '1840001', totalPriceMinor: '3680002' })).toBeNull();
    // The same number per a different unit or on different delivery terms is not the same price.
    expect(differ({ ...terms, unit: 'set' })).toBeNull();
    expect(differ({ ...terms, incoterm: 'DDP' })).toBeNull();
  });
  it('names other missing terms with the engine labels, and says nothing when nothing is missing', () => {
    const general = missingTermNotice(
      experience(
        [offer('qa', 't1', terms), offer('qb', 't2', { ...terms, leadTime: undefined })],
        'supplier_sourcing',
      ),
      at,
    );
    expect(general?.title).toBe('One quote leaves out terms');
    expect(general?.lines).toEqual([
      {
        key: 'qb',
        supplier: '绿野机械有限公司',
        lang: 'zh',
        words: 'has not stated: Lead time.',
      },
    ]);
    expect(
      missingTermNotice(
        experience([offer('qa', 't1', terms), offer('qb', 't2', terms)], 'supplier_sourcing'),
        at,
      ),
    ).toBeNull();
  });
  it('a superseded or out-of-date quote is not a current quote and is not named', () => {
    expect(
      missingTermNotice(
        experience([
          offer('qa', 't1', { ...terms, commissioning: 'Included' }),
          offer('qb', 't2', terms, { superseded: true }),
        ]),
        at,
      ),
    ).toBeNull();
  });
});

describe('a read that fails is said as a failed read', () => {
  it('a list that throws is unreadable, never "nothing yet"', async () => {
    const { roomLoadFrom } = await import('../../apps/web/lib/room-loader');
    for (const page of [
      async () => {
        throw new Error('connection reset');
      },
      async (after?: string) => {
        if (after) throw new Error('second page failed');
        return { assignments: [row(a1)], nextAfter: a1 };
      },
    ])
      expect(await roomLoadFrom(request, page, a1)).toEqual({
        status: 'unreadable',
        link: { reportAvailable: false, savedResourceId: null },
      });
  });
  it('a readable list resolves the hint against that list only', async () => {
    const { roomLoadFrom } = await import('../../apps/web/lib/room-loader');
    expect(
      await roomLoadFrom(request, async () => ({ assignments: [row(a1)], nextAfter: null }), a1),
    ).toMatchObject({
      status: 'ok',
      task: { kind: 'save', report: { assignmentId: a1 } },
      hintClosed: false,
    });
  });
});
