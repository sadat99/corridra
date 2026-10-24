import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareOffers } from '../../packages/domain/src/commercial-missions';
import { emblemFor, roadRecords, roomLinkFor } from '../../apps/web/lib/room';
import { factNameFor, quoteCardsFrom, reasonFor } from '../../apps/web/lib/quote-cards';
import { buildMoveModel } from '../../apps/web/lib/move-cards';

// The Room and the lenses (Lane 5 of the UX update). The comparison engine is untouched; these checks
// prove the cards only repeat what it says, the Room reads only a report that is really linked to the
// request, and every switch-off path is the page it was.
const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('the emblem', () => {
  it('is built from the words, the same every time, with one of four fixed tones', () => {
    expect(emblemFor('Automatic fabric cutting machine')).toEqual(
      emblemFor('Automatic fabric cutting machine'),
    );
    expect(emblemFor('Automatic fabric cutting machine').initials).toBe('AF');
    expect(emblemFor('Zippers').initials).toBe('ZI');
    expect(emblemFor('  ').initials).toBe('?');
    for (const name of ['a', 'Source LED lights', 'বাংলাদেশ থেকে চীন', '绿野机械有限公司', 'x y z'])
      expect([0, 1, 2, 3]).toContain(emblemFor(name).tone);
  });
  it('spreads different names across tones and handles other scripts', () => {
    const tones = new Set(
      ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'].map(
        (n) => emblemFor(n).tone,
      ),
    );
    expect(tones.size).toBeGreaterThan(1);
    expect(emblemFor('绿野 机械').initials).toBe('绿机');
  });
});

describe('which report belongs to a request', () => {
  const request = '11111111-1111-4111-8111-111111111111';
  const saved = '33333333-3333-4333-8333-333333333333';
  it('finds nothing when no assignment names this request', () => {
    expect(roomLinkFor(request, [])).toEqual({ reportAvailable: false, savedResourceId: null });
    expect(roomLinkFor(request, null)).toEqual({ reportAvailable: false, savedResourceId: null });
    expect(
      roomLinkFor(request, [
        { requestId: '22222222-2222-4222-8222-222222222222', available: true },
      ]),
    ).toEqual({ reportAvailable: false, savedResourceId: null });
  });
  it('ignores an assignment that is not available, and a saved id that is not an id', () => {
    expect(roomLinkFor(request, [{ requestId: request, available: false }])).toEqual({
      reportAvailable: false,
      savedResourceId: null,
    });
    expect(
      roomLinkFor(request, [{ requestId: request, available: true, savedResourceId: 'not-an-id' }]),
    ).toEqual({ reportAvailable: true, savedResourceId: null });
  });
  it('knows a delivered report, and its saved copy once there is one', () => {
    expect(
      roomLinkFor(request, [{ requestId: request, available: true, savedResourceId: null }]),
    ).toEqual({ reportAvailable: true, savedResourceId: null });
    expect(
      roomLinkFor(request, [{ requestId: request, available: true, savedResourceId: saved }]),
    ).toEqual({ reportAvailable: true, savedResourceId: saved });
  });
  it('lets the Road light Compare from a delivered report and never claims a decision', () => {
    expect(roadRecords({ reportAvailable: true, savedResourceId: null })).toEqual({
      compare: true,
      decide: false,
    });
    expect(roadRecords({ reportAvailable: false, savedResourceId: null })).toEqual({
      compare: false,
      decide: false,
    });
  });
});

describe('quote cards repeat the engine and add nothing', () => {
  const when = '2099-01-01T00:00:00.000Z';
  const full = {
    specification: 'Auto cutter 2.5 m bed',
    quantity: '2',
    unit: 'unit',
    unitPriceMinor: '1840000',
    totalPriceMinor: '3680000',
    leadTime: '45 days',
    validUntil: when,
    incoterm: 'FOB' as const,
    shipping: 'EXCLUDED' as const,
    paymentTerms: '30% deposit, 70% before shipping',
    toolingMinor: '0',
    setupMinor: '0',
    packagingMinor: '0',
  };
  const offer = (id: string, terms: Record<string, unknown>, extra = {}) => ({
    id,
    targetId: id === 'b' ? 't2' : 't1',
    currency: 'USD',
    terms,
    revision: 1,
    uncertainties: 'None stated',
    sourceKind: 'self_declaration',
    claimStatus: 'self_declared',
    superseded: false,
    assignmentCurrent: true,
    ...extra,
  });
  const shortlist = [
    {
      id: 't1',
      company: 'Lantern Cutting Works',
      country: 'China',
      fit: 'HIGH',
      rationale: '',
      uncertainty: '',
      gaps: '',
      verification: '',
    },
    {
      id: 't2',
      company: '绿野机械有限公司',
      country: 'China',
      fit: 'MEDIUM',
      rationale: '',
      uncertainty: '',
      gaps: '',
      verification: '',
    },
  ];
  const offers = [
    offer('a', full),
    offer('b', { ...full, leadTime: undefined, paymentTerms: undefined }),
  ] as never[];
  const verdicts = compareOffers(
    (offers as { id: string; currency: string; terms: never }[]).map((o) => ({
      id: o.id,
      currency: o.currency,
      terms: o.terms,
      requirementId: '1',
      uncertainties: '',
      evidenceCurrent: true,
    })),
  );

  it('says comparable only where the engine says so, and gives the engine reason otherwise', () => {
    const cards = quoteCardsFrom({ offers, verdicts, shortlist: shortlist as never });
    expect(verdicts.map((v) => v.status)).toEqual([
      'COMPARABLE ON SUPPLIED TERMS',
      'NOT COMPARABLE',
    ]);
    expect(cards.map((c) => c.comparable)).toEqual([true, false]);
    expect(cards[0].reason).toBeUndefined();
    expect(cards[1].reason).toBe('Missing: Lead time, Payment terms.');
  });

  it('keeps the original currency with its code, exact amounts, and shows a missing term as not stated', () => {
    const [first, second] = quoteCardsFrom({ offers, verdicts, shortlist: shortlist as never });
    const plain = (value: string | null) => value?.replace(/\u00a0/g, ' ');
    expect(plain(first.unitPrice)).toBe('USD 18,400.00');
    expect(plain(first.total)).toBe('USD 36,800.00');
    expect(first.currency).toBe('USD');
    const lead = second.terms.find((t) => t.label === 'Lead time');
    expect(lead?.value).toBeNull();
    expect(first.terms.find((t) => t.label === 'Lead time')?.value).toBe('45 days');
    expect(first.terms.find((t) => t.label === 'Quantity')?.value).toBe('2 unit');
  });

  it('marks a Chinese supplier name so it is read as Chinese, and keeps names as written', () => {
    const cards = quoteCardsFrom({ offers, verdicts, shortlist: shortlist as never });
    expect(cards[1]).toMatchObject({ supplier: '绿野机械有限公司', supplierLang: 'zh' });
    expect(cards[0]).toMatchObject({ supplier: 'Lantern Cutting Works', supplierLang: undefined });
  });

  it('never invents a verdict: no card is comparable when the engine says every offer is not', () => {
    const none = offers.map((o) => ({
      ...(o as object),
      terms: { unitPriceMinor: '100' },
    })) as never[];
    const v = compareOffers(
      (none as { id: string; currency: string; terms: never }[]).map((o) => ({
        id: o.id,
        currency: o.currency,
        terms: o.terms,
        requirementId: '1',
        uncertainties: '',
        evidenceCurrent: true,
      })),
    );
    expect(
      quoteCardsFrom({ offers: none, verdicts: v, shortlist: shortlist as never }).every(
        (c) => !c.comparable,
      ),
    ).toBe(true);
  });

  it('explains every reason in the engine terms', () => {
    expect(reasonFor({ status: 'NOT COMPARABLE', missing: [], expired: true })).toBe(
      'The offer has expired.',
    );
    expect(reasonFor({ status: 'NOT COMPARABLE', missing: [], inconsistentTotal: true })).toBe(
      'The total does not match unit price times quantity.',
    );
    expect(reasonFor({ status: 'NOT COMPARABLE', missing: [], evidenceCurrent: false })).toBe(
      'It does not match the current request.',
    );
    expect(reasonFor({ status: 'NOT COMPARABLE', missing: [] })).toBe(
      'Its terms differ from the other offers.',
    );
    expect(reasonFor({ status: 'COMPARABLE ON SUPPLIED TERMS', missing: [] })).toBe('');
  });

  it('shows a fact label only for the five names, and never a weaker word than the claim states', () => {
    expect(factNameFor('self_declared')).toBe('Self-declared');
    expect(factNameFor('Self-declared')).toBe('Self-declared');
    expect(factNameFor('VERIFIED')).toBe('Verified');
    expect(factNameFor('evidence available')).toBe('Evidence available');
    expect(factNameFor('something_new')).toBeNull();
    const cards = quoteCardsFrom({
      offers: [offer('a', full, { claimStatus: 'something_new' })] as never[],
      verdicts: verdicts.slice(0, 1),
      shortlist: shortlist as never,
    });
    expect(cards[0].trust).toBeNull();
    expect(cards[0].provenance).toBe('self_declaration · something_new');
  });
});

describe('Your Move opens the Room only when the Road is on', () => {
  const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'A', role: 'owner' as const };
  const input = {
    workspaces: [owner],
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [
      {
        id: 'r1',
        workspaceId: owner.id,
        createdAt: '2026-10-02T00:00:00Z',
        progress: { status: 'OUTREACH', receivedAt: '2026-10-02T09:00:00Z', replies: [] },
      },
    ],
  };
  it('links to the saved request page by default and to the Room with the switch', () => {
    expect(buildMoveModel(input).waiting[0].href).toBe('/account/requests/r1');
    expect(buildMoveModel(input, { rooms: true }).waiting[0].href).toBe('/account/rooms/r1');
    expect(buildMoveModel(input, { rooms: true }).latest?.href).toBe('/account/rooms/r1');
  });
});

describe('the switches and the pages', () => {
  it('the Room does not exist unless the Road switch is on, and checks the sign-in first', () => {
    const page = read('apps/web/app/account/rooms/[requestId]/page.tsx');
    expect(page).toContain("uxSwitchOn('CORRIDRA_UX_ROAD')");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain('customerPageSession');
    expect(page).toContain("lenses={uxSwitchOn('CORRIDRA_UX_LENSES')}");
  });
  it('the saved request page only gains a link, behind the Road switch', () => {
    const page = read('apps/web/app/account/requests/[requestId]/page.tsx');
    expect(page).toContain("uxSwitchOn('CORRIDRA_UX_ROAD')");
    expect((page.match(/uxSwitchOn/g) ?? []).length).toBe(2);
  });
  it('the saved mission page passes the lens switch and the report defaults to the whole page', () => {
    expect(read('apps/web/app/account/missions/[resourceId]/page.tsx')).toContain(
      "lenses={uxSwitchOn('CORRIDRA_UX_LENSES')}",
    );
    const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
    expect(report).toContain("section = 'all'");
    expect(report).toContain('lenses = false');
  });
  it('the experience view keeps the matrix as it was when the lenses are off', () => {
    const view = read('apps/web/app/mission-experience-view.tsx');
    expect(view).toContain('lenses = false');
    expect(view).toMatch(
      /\) : \(\s*<ComparisonMatrix offers=\{e\.quotations\.filter\(inLens\)\} language=\{language\} \/>/,
    );
  });
  it('the comparison matrix file is not touched', () => {
    expect(read('apps/web/components/comparison-matrix.tsx')).not.toContain('QuoteCard');
  });
});
